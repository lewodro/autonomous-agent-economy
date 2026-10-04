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

pub mod backend_escrow;
pub mod backend_rail;
pub mod fees;
pub mod host_config;
pub mod local_rail;
pub mod local_signer;
pub mod local_transaction;

pub mod host;
pub mod host_api;
mod host_events;
pub mod host_factory;

pub mod health;
