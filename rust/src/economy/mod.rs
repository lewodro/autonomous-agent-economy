//! Match economy sidecar. It never changes simulation rules or survival credits.
pub mod primitives;

pub mod lifecycle;

pub mod config;

pub mod events;

pub mod treasury;

pub mod rail;

pub mod mock_rail;

pub mod escrow;

pub mod mock_escrow;

pub mod binding;

pub mod coordinator;

pub mod settlement;

pub mod refund;

pub mod signing;

pub mod mock_signer;

pub mod devnet;

pub mod scenario;

pub mod demo;

pub mod lab;

pub mod records;
pub mod repository;

pub mod durable_rail;
pub mod recovery;

pub mod attestation;

pub mod local_signer;
