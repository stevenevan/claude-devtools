/// SFTP file system provider — wraps russh-sftp for file access.

use russh_sftp::client::SftpSession;

/// Read a file's content as a UTF-8 string via SFTP.
pub async fn read_file(sftp: &SftpSession, path: &str) -> Result<String, String> {
    let data = sftp
        .read(path)
        .await
        .map_err(|e| format!("SFTP read failed for {path}: {e}"))?;
    String::from_utf8(data).map_err(|e| format!("Invalid UTF-8 in {path}: {e}"))
}

/// Check if a file exists via SFTP.
pub async fn exists(sftp: &SftpSession, path: &str) -> bool {
    sftp.try_exists(path).await.unwrap_or(false)
}

/// List directory entries via SFTP.
pub async fn readdir(sftp: &SftpSession, path: &str) -> Result<Vec<SftpDirent>, String> {
    let entries = sftp
        .read_dir(path)
        .await
        .map_err(|e| format!("SFTP readdir failed for {path}: {e}"))?;

    Ok(entries
        .into_iter()
        .map(|entry| {
            let is_dir = entry.file_type().is_dir();
            SftpDirent {
                name: entry.file_name(),
                is_file: !is_dir,
                is_directory: is_dir,
            }
        })
        .collect())
}

#[derive(Debug)]
pub struct SftpDirent {
    pub name: String,
    pub is_file: bool,
    pub is_directory: bool,
}

/// Placeholder for SftpFileSystemProvider that wraps the SFTP session.
/// Used by SSH-aware data commands to read remote session files.
pub struct SftpFileSystemProvider {
    sftp: SftpSession,
}

impl SftpFileSystemProvider {
    pub fn new(sftp: SftpSession) -> Self {
        Self { sftp }
    }

    pub fn sftp(&self) -> &SftpSession {
        &self.sftp
    }
}
