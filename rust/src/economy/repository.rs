//! Single-writer append-only local JSON repository. Atomic rename + fsync before acknowledgement.
use super::primitives::*;
use crate::hashing::sha256_hex;
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{json, Value};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};
pub trait RecoveryRepository {
    fn read<T: DeserializeOwned>(&self, key: &str) -> Result<Option<T>>;
    fn write<T: Serialize>(&self, key: &str, value: &T) -> Result<()>;
}
pub struct JsonRepository {
    directory: PathBuf,
    _lease: File,
}
fn storage(e: impl std::fmt::Display) -> EconomyError {
    EconomyError::StorageFailure(e.to_string())
}
impl JsonRepository {
    pub fn open(directory: impl AsRef<Path>) -> Result<Self> {
        fs::create_dir_all(directory.as_ref()).map_err(storage)?;
        let lease = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(directory.as_ref().join("writer.lock"))
            .map_err(storage)?;
        lease.try_lock().map_err(|_| EconomyError::Conflict)?;
        Ok(Self {
            directory: directory.as_ref().into(),
            _lease: lease,
        })
    }
    fn revisions(&self, key: &str) -> Result<Vec<PathBuf>> {
        OperationId::new(key)?;
        let prefix = format!("{key}--");
        let mut paths = vec![];
        for entry in fs::read_dir(&self.directory).map_err(storage)? {
            let entry = entry.map_err(storage)?;
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with(&prefix) && name.ends_with(".json") {
                paths.push(entry.path());
            }
        }
        paths.sort();
        Ok(paths)
    }
}
impl RecoveryRepository for JsonRepository {
    fn read<T: DeserializeOwned>(&self, key: &str) -> Result<Option<T>> {
        let paths = self.revisions(key)?;
        let Some(path) = paths.last() else {
            return Ok(None);
        };
        let mut bytes = vec![];
        File::open(path)
            .map_err(storage)?
            .take(64_000_001)
            .read_to_end(&mut bytes)
            .map_err(storage)?;
        if bytes.len() > 64_000_000 {
            return Err(storage("Record size limit"));
        }
        let record: Value = serde_json::from_slice(&bytes).map_err(storage)?;
        let payload = serde_json::to_vec(&record["payload"]).map_err(storage)?;
        let digest = sha256_hex(payload);
        if record["format"] != 1 || record["sha256"] != digest {
            return Err(storage("Corrupt journal envelope"));
        }
        serde_json::from_value(record["payload"].clone())
            .map(Some)
            .map_err(storage)
    }
    fn write<T: Serialize>(&self, key: &str, value: &T) -> Result<()> {
        let paths = self.revisions(key)?;
        let payload = serde_json::to_value(value).map_err(storage)?;
        let digest = sha256_hex(serde_json::to_vec(&payload).map_err(storage)?);
        let bytes = serde_json::to_vec(&json!({"format":1,"sha256":digest,"payload":payload}))
            .map_err(storage)?;
        if bytes.len() > 64_000_000 {
            return Err(storage("Record size limit"));
        }
        let target = self
            .directory
            .join(format!("{key}--{:012}.json", paths.len()));
        if target.exists() {
            return Err(EconomyError::Conflict);
        }
        let temp = self
            .directory
            .join(format!("{key}--{}.tmp", std::process::id()));
        // A crash may leave a temp file. It is never a committed revision.
        let mut options = OpenOptions::new();
        options.create(true).truncate(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temp).map_err(storage)?;
        file.write_all(&bytes).map_err(storage)?;
        file.sync_all().map_err(storage)?;
        fs::rename(&temp, &target).map_err(storage)?;
        File::open(&self.directory)
            .map_err(storage)?
            .sync_all()
            .map_err(storage)?;
        Ok(())
    }
}
