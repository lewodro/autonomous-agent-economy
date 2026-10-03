use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "code", content = "detail", rename_all = "snake_case")]
pub enum EconomyError {
    InvalidInput(String),
    InvalidAttestation,
    RpcUnavailable(String),
    TransactionNotFound,
    TransactionFailed,
    WrongRecipient,
    WrongAmount,
    AlreadyConsumed,
    FundingClosed,
    InvalidTransition(String),
    InsufficientFunds,
    Overflow,
    Conflict,
    UnverifiedPayment,
    SettlementNotAuthorized,
    MainnetNotImplemented,
    NotImplemented(String),
    AdapterFailure(String),
}
impl fmt::Display for EconomyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{self:?}")
    }
}
impl std::error::Error for EconomyError {}
pub type Result<T> = std::result::Result<T, EconomyError>;

/// Base units, serialized as a decimal string to preserve precision in browsers.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct Amount(u64);
impl Amount {
    pub const ZERO: Self = Self(0);
    pub const fn new(units: u64) -> Self {
        Self(units)
    }
    pub const fn units(self) -> u64 {
        self.0
    }
    pub fn add(self, other: Self) -> Result<Self> {
        self.0
            .checked_add(other.0)
            .map(Self)
            .ok_or(EconomyError::Overflow)
    }
    pub fn subtract(self, other: Self) -> Result<Self> {
        self.0
            .checked_sub(other.0)
            .map(Self)
            .ok_or(EconomyError::InsufficientFunds)
    }
    pub fn multiply(self, count: u64) -> Result<Self> {
        self.0
            .checked_mul(count)
            .map(Self)
            .ok_or(EconomyError::Overflow)
    }
}
impl TryFrom<String> for Amount {
    type Error = EconomyError;
    fn try_from(value: String) -> Result<Self> {
        if value.is_empty()
            || value.len() > 20
            || (value.len() > 1 && value.starts_with('0'))
            || !value.bytes().all(|b| b.is_ascii_digit())
        {
            return Err(EconomyError::InvalidInput(
                "Canonical base units required".into(),
            ));
        }
        value
            .parse::<u64>()
            .map(Self)
            .map_err(|_| EconomyError::Overflow)
    }
}
impl From<Amount> for String {
    fn from(value: Amount) -> String {
        value.0.to_string()
    }
}

macro_rules! identifier {
    ($name:ident) => {
        #[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
        #[serde(try_from = "String", into = "String")]
        pub struct $name(String);
        impl $name {
            pub fn new(value: impl Into<String>) -> Result<Self> {
                let value = value.into();
                if value.is_empty()
                    || value.len() > 80
                    || !value
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b"-_".contains(&b))
                {
                    return Err(EconomyError::InvalidInput(
                        "Simple public identifier required".into(),
                    ));
                }
                Ok(Self(value))
            }
            pub fn as_str(&self) -> &str {
                &self.0
            }
        }
        impl TryFrom<String> for $name {
            type Error = EconomyError;
            fn try_from(value: String) -> Result<Self> {
                Self::new(value)
            }
        }
        impl From<$name> for String {
            fn from(value: $name) -> String {
                value.0
            }
        }
    };
}
identifier!(AgentId);
identifier!(RunId);
identifier!(OperationId);
identifier!(AccountId);
