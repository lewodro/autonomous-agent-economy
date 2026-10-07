//! Development-only secrets. Fixed backend paths; no key material is serializable.
use super::{primitives::*, signing::*};
use ed25519_dalek::{Signer, SigningKey};
use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::Path,
};
pub struct LocalDevSigner {
    identity: WalletIdentity,
    key: SigningKey,
}
impl LocalDevSigner {
    pub fn load_or_create(path: &Path, agent: AgentId) -> Result<Self> {
        let parent = path
            .parent()
            .ok_or_else(|| EconomyError::InvalidInput("Key directory required".into()))?;
        fs::create_dir_all(parent).map_err(|e| EconomyError::AdapterFailure(e.to_string()))?;
        let bytes = match fs::symlink_metadata(path) {
            Ok(metadata) => {
                if metadata.file_type().is_symlink() || !metadata.is_file() {
                    return Err(EconomyError::InvalidInput(
                        "Development key must be a regular file, not a symlink".into(),
                    ));
                }
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    if metadata.permissions().mode() & 0o077 != 0 {
                        return Err(EconomyError::InvalidInput(
                            "Development key must have private file permissions".into(),
                        ));
                    }
                }
                let file = OpenOptions::new()
                    .read(true)
                    .open(path)
                    .map_err(|e| EconomyError::AdapterFailure(e.to_string()))?;
                if !file
                    .metadata()
                    .map_err(|e| EconomyError::AdapterFailure(e.to_string()))?
                    .is_file()
                {
                    return Err(EconomyError::InvalidInput(
                        "Development key must be a regular file".into(),
                    ));
                }
                let mut bytes = Vec::with_capacity(33);
                file.take(33)
                    .read_to_end(&mut bytes)
                    .map_err(|e| EconomyError::AdapterFailure(e.to_string()))?;
                if bytes.len() != 32 {
                    return Err(EconomyError::InvalidInput(
                        "Development key requires exactly 32 bytes".into(),
                    ));
                }
                bytes
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                let key = crate::wallet::key().map_err(EconomyError::AdapterFailure)?;
                let bytes = key.to_bytes();
                let mut options = OpenOptions::new();
                options.write(true).create_new(true);
                #[cfg(unix)]
                {
                    use std::os::unix::fs::OpenOptionsExt;
                    options.mode(0o600);
                }
                let mut file = options
                    .open(path)
                    .map_err(|e| EconomyError::AdapterFailure(e.to_string()))?;
                file.write_all(&bytes)
                    .map_err(|e| EconomyError::AdapterFailure(e.to_string()))?;
                file.sync_all()
                    .map_err(|e| EconomyError::AdapterFailure(e.to_string()))?;
                std::fs::File::open(parent)
                    .and_then(|f| f.sync_all())
                    .map_err(|e| EconomyError::AdapterFailure(e.to_string()))?;
                bytes.to_vec()
            }
            Err(e) => return Err(EconomyError::AdapterFailure(e.to_string())),
        };
        let seed: [u8; 32] = bytes
            .try_into()
            .map_err(|_| EconomyError::InvalidInput("Development key requires 32 bytes".into()))?;
        let key = SigningKey::from_bytes(&seed);
        Ok(Self {
            identity: WalletIdentity {
                agent_id: agent,
                address: PublicAddress::new(crate::wallet::address(&key))?,
            },
            key,
        })
    }
    pub fn signature(&self, message: &[u8]) -> [u8; 64] {
        self.key.sign(message).to_bytes()
    }
    pub fn authority(self) -> super::attestation::HostAuthority {
        super::attestation::HostAuthority::new(self.key)
    }
}
impl SigningBackend for LocalDevSigner {
    fn identity(&self) -> WalletIdentity {
        self.identity.clone()
    }
    fn sign_message(&self, message: &[u8]) -> Result<SignedArtifact> {
        if message.len() > 16_384 {
            return Err(EconomyError::InvalidInput("Message too large".into()));
        }
        Ok(SignedArtifact {
            signer: self.identity.address.clone(),
            domain: SigningDomain::PublicMessage,
            signature: bs58::encode(
                self.signature(&[b"last-seat/local-message/v1:".as_slice(), message].concat()),
            )
            .into_string(),
        })
    }
    fn sign_transaction(&self, message: &[u8]) -> Result<SignedArtifact> {
        if message.len() > 1100 {
            return Err(EconomyError::InvalidInput("Transaction too large".into()));
        }
        Ok(SignedArtifact {
            signer: self.identity.address.clone(),
            domain: SigningDomain::SolanaTransaction,
            signature: bs58::encode(self.signature(message)).into_string(),
        })
    }
}
