use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
  #[error("Database error: {0}")]
  Db(#[from] rusqlite::Error),

  #[error("Invalid input: {0}")]
  Invalid(String),

  #[error("IO error: {0}")]
  Io(#[from] std::io::Error),
}

pub type AppResult<T> = Result<T, AppError>;

