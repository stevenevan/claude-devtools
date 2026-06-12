export const LOCAL_COMMAND_STDOUT_TAG = '<local-command-stdout>';
export const LOCAL_COMMAND_STDERR_TAG = '<local-command-stderr>';
const LOCAL_COMMAND_CAVEAT_TAG = '<local-command-caveat>';
const SYSTEM_REMINDER_TAG = '<system-reminder>';

export const EMPTY_STDOUT = '<local-command-stdout></local-command-stdout>';
export const EMPTY_STDERR = '<local-command-stderr></local-command-stderr>';

export const SYSTEM_OUTPUT_TAGS = [
  LOCAL_COMMAND_STDERR_TAG,
  LOCAL_COMMAND_STDOUT_TAG,
  LOCAL_COMMAND_CAVEAT_TAG,
  SYSTEM_REMINDER_TAG,
] as const;

export const HARD_NOISE_TAGS = [LOCAL_COMMAND_CAVEAT_TAG, SYSTEM_REMINDER_TAG] as const;
