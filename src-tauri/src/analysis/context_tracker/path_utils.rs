/// Path utility functions ported from contextTracker.ts.

/// Check if a path is absolute (Unix, Windows, tilde, UNC).
pub fn is_absolute_path(path: &str) -> bool {
    path.starts_with('/')
        || path.starts_with("~/")
        || path.starts_with("~\\")
        || path == "~"
        || path.starts_with("\\\\")
        || (path.len() >= 3
            && path.as_bytes()[0].is_ascii_alphabetic()
            && path.as_bytes()[1] == b':'
            && (path.as_bytes()[2] == b'/' || path.as_bytes()[2] == b'\\'))
}

/// Remove trailing separators from a path.
pub fn trim_trailing_separator(input: &str) -> &str {
    input.trim_end_matches(|c: char| c == '/' || c == '\\')
}

/// Normalize all separators to the given separator, collapsing consecutive separators.
pub fn normalize_separators(input: &str, separator: char) -> String {
    let mut output = String::with_capacity(input.len());
    let mut prev_was_sep = false;

    for ch in input.chars() {
        let is_sep = ch == '/' || ch == '\\';
        if is_sep {
            if !prev_was_sep {
                output.push(separator);
            }
            prev_was_sep = true;
        } else {
            output.push(ch);
            prev_was_sep = false;
        }
    }

    output
}

/// Split a path into its component parts, ignoring empty segments.
pub fn split_path(input: &str) -> Vec<&str> {
    input
        .split(|c: char| c == '/' || c == '\\')
        .filter(|s| !s.is_empty())
        .collect()
}

/// Normalize a path for comparison by replacing all backslashes with forward slashes.
pub fn normalize_for_comparison(input: &str) -> String {
    input.replace('\\', "/")
}

/// Join a base path with a relative path, handling `./`, `../`, `@` prefixes,
/// and absolute relative paths.
pub fn join_paths(base: &str, relative: &str) -> String {
    if is_absolute_path(relative) {
        return relative.to_string();
    }

    let clean_base = trim_trailing_separator(base);

    // Strip @ prefix (file mention marker)
    let mut clean_relative = relative;
    if let Some(stripped) = clean_relative.strip_prefix('@') {
        clean_relative = stripped;
    }

    // Strip ./ prefix
    if let Some(stripped) = clean_relative.strip_prefix("./") {
        clean_relative = stripped;
    }

    // Determine separator
    let separator = if clean_base.contains('\\') {
        '\\'
    } else {
        '/'
    };
    let has_unix_root = clean_base.starts_with('/');
    let has_unc_root = clean_base.starts_with("\\\\");

    let normalized_relative = normalize_separators(clean_relative, separator);
    let mut base_parts: Vec<&str> = split_path(clean_base);

    let sep_str = if separator == '/' { "/" } else { "\\" };
    let parent_prefix = format!("..{}", separator);

    let mut remaining = normalized_relative.as_str();
    while remaining.starts_with(&parent_prefix) {
        remaining = &remaining[3..];
        if base_parts.len() > 1 {
            base_parts.pop();
        }
    }

    let mut normalized_base = base_parts.join(sep_str);
    if has_unix_root && !normalized_base.starts_with('/') {
        normalized_base = format!("/{}", normalized_base);
    }
    if has_unc_root && !normalized_base.starts_with("\\\\") {
        normalized_base = format!("\\\\{}", normalized_base);
    }

    if remaining.is_empty() {
        normalized_base
    } else {
        format!("{}{}{}", normalized_base, separator, remaining)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_absolute_unix() {
        assert!(is_absolute_path("/Users/test"));
        assert!(is_absolute_path("/"));
    }

    #[test]
    fn is_absolute_windows() {
        assert!(is_absolute_path("C:\\Users\\test"));
        assert!(is_absolute_path("D:/Projects"));
    }

    #[test]
    fn is_absolute_tilde() {
        assert!(is_absolute_path("~/project"));
        assert!(is_absolute_path("~"));
    }

    #[test]
    fn is_absolute_unc() {
        assert!(is_absolute_path("\\\\server\\share"));
    }

    #[test]
    fn relative_is_not_absolute() {
        assert!(!is_absolute_path("src/main.ts"));
        assert!(!is_absolute_path("./file.ts"));
        assert!(!is_absolute_path("@src/lib.ts"));
    }

    #[test]
    fn join_absolute_relative_returns_relative() {
        assert_eq!(
            join_paths("/base", "/absolute/path"),
            "/absolute/path"
        );
    }

    #[test]
    fn join_simple_relative() {
        assert_eq!(
            join_paths("/Users/test/project", "src/main.ts"),
            "/Users/test/project/src/main.ts"
        );
    }

    #[test]
    fn join_strips_dot_slash() {
        assert_eq!(
            join_paths("/base", "./file.ts"),
            "/base/file.ts"
        );
    }

    #[test]
    fn join_strips_at_prefix() {
        assert_eq!(
            join_paths("/base", "@src/lib.ts"),
            "/base/src/lib.ts"
        );
    }

    #[test]
    fn join_parent_paths() {
        assert_eq!(
            join_paths("/Users/test/project/src", "../other/file.ts"),
            "/Users/test/project/other/file.ts"
        );
    }

    #[test]
    fn join_multiple_parent_paths() {
        assert_eq!(
            join_paths("/a/b/c/d", "../../file.ts"),
            "/a/b/file.ts"
        );
    }

    #[test]
    fn trim_trailing_sep() {
        assert_eq!(trim_trailing_separator("/a/b/"), "/a/b");
        assert_eq!(trim_trailing_separator("/a/b\\\\"), "/a/b");
        assert_eq!(trim_trailing_separator("hello"), "hello");
    }

    #[test]
    fn split_path_works() {
        assert_eq!(split_path("/Users/test/file.ts"), vec!["Users", "test", "file.ts"]);
        assert_eq!(split_path("a/b/c"), vec!["a", "b", "c"]);
    }

    #[test]
    fn normalize_for_comparison_replaces_backslash() {
        assert_eq!(
            normalize_for_comparison("C:\\Users\\test"),
            "C:/Users/test"
        );
    }
}
