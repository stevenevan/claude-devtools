/// Message tag constants — centralized XML tag strings for parsing and filtering.

pub const LOCAL_COMMAND_STDOUT_TAG: &str = "<local-command-stdout>";
pub const LOCAL_COMMAND_STDERR_TAG: &str = "<local-command-stderr>";
pub const LOCAL_COMMAND_CAVEAT_TAG: &str = "<local-command-caveat>";
pub const SYSTEM_REMINDER_TAG: &str = "<system-reminder>";

pub const EMPTY_STDOUT: &str = "<local-command-stdout></local-command-stdout>";
pub const EMPTY_STDERR: &str = "<local-command-stderr></local-command-stderr>";

/// Tags that indicate system output (excludes from User chunks).
pub const SYSTEM_OUTPUT_TAGS: &[&str] = &[
    LOCAL_COMMAND_STDERR_TAG,
    LOCAL_COMMAND_STDOUT_TAG,
    LOCAL_COMMAND_CAVEAT_TAG,
    SYSTEM_REMINDER_TAG,
];

/// Tags that indicate hard noise (messages filtered completely).
pub const HARD_NOISE_TAGS: &[&str] = &[LOCAL_COMMAND_CAVEAT_TAG, SYSTEM_REMINDER_TAG];
