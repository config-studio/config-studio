package guard

import (
	"bytes"
	"encoding/json"
	"fmt"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"github.com/pelletier/go-toml/v2"
	"gopkg.in/yaml.v3"
)

var (
	yamlLineColRegex = regexp.MustCompile(`line\s+(\d+)(?::\s*(?:column|col)\s+(\d+))?`)
	yamlLineRegex    = regexp.MustCompile(`line\s+(\d+)`)
)

// Validate analyzes configuration content according to the file format.
func Validate(filePath string, content []byte) ValidationResult {
	ext := strings.ToLower(filepath.Ext(filePath))
	base := strings.ToLower(filepath.Base(filePath))

	res := ValidationResult{
		Valid:     true,
		IsGuarded: true,
		Issues:    []GuardIssue{},
	}

	// Route to specific validator by format
	switch {
	case ext == ".yaml" || ext == ".yml":
		res.Issues = append(res.Issues, validateYAML(filePath, content)...)
	case ext == ".json" || ext == ".jsonc":
		res.Issues = append(res.Issues, validateJSON(filePath, content)...)
	case ext == ".toml":
		res.Issues = append(res.Issues, validateTOML(filePath, content)...)
	case strings.HasPrefix(base, ".env") || strings.HasSuffix(base, ".env"):
		res.Issues = append(res.Issues, validateENV(filePath, content)...)
	case base == "nginx.conf" || strings.HasSuffix(base, ".conf") || base == "caddyfile":
		res.Issues = append(res.Issues, validateConf(filePath, content)...)
	case strings.HasSuffix(base, ".service") || strings.HasSuffix(base, ".timer") || strings.HasSuffix(base, ".socket"):
		res.Issues = append(res.Issues, validateSystemdUnit(filePath, content)...)
	default:
		// Attempt general format detection if extensions don't match
		trimmed := bytes.TrimSpace(content)
		if len(trimmed) > 0 {
			if (trimmed[0] == '{' && trimmed[len(trimmed)-1] == '}') || (trimmed[0] == '[' && trimmed[len(trimmed)-1] == ']') {
				res.Issues = append(res.Issues, validateJSON(filePath, content)...)
			}
		}
	}

	// If any critical issues found, Valid = false
	for _, issue := range res.Issues {
		if issue.Severity == SeverityCritical {
			res.Valid = false
			break
		}
	}

	return res
}

// validateYAML parses YAML AST and inspects indentation and syntax.
func validateYAML(filePath string, content []byte) []GuardIssue {
	var issues []GuardIssue

	// 1. Pre-check for tab indentation (YAML standard prohibits tab indentation)
	lines := strings.Split(string(content), "\n")
	for i, l := range lines {
		trimmed := strings.TrimRight(l, "\r\n")
		// If line has indentation that contains tab
		indent := ""
		for _, ch := range trimmed {
			if ch == ' ' || ch == '\t' {
				indent += string(ch)
			} else {
				break
			}
		}
		if strings.Contains(indent, "\t") {
			lineNum := i + 1
			issues = append(issues, GuardIssue{
				File:     filePath,
				Severity: SeverityCritical,
				Line:     lineNum,
				Column:   strings.Index(indent, "\t") + 1,
				Message:  "YAML forbids tab characters for indentation; use spaces instead.",
				Snippet:  MakeSnippet(content, lineNum),
				Rule:     "yaml_no_tabs",
			})
			// Tab error is fatal in YAML parsers, so return early
			return issues
		}
	}

	// 2. Strict AST Decode
	var node yaml.Node
	decoder := yaml.NewDecoder(bytes.NewReader(content))
	for {
		err := decoder.Decode(&node)
		if err != nil {
			if err.Error() == "EOF" {
				break
			}

			lineNum := 1
			colNum := 1
			errMsg := err.Error()

			if m := yamlLineColRegex.FindStringSubmatch(errMsg); len(m) >= 2 {
				if l, e := strconv.Atoi(m[1]); e == nil {
					lineNum = l
				}
				if len(m) >= 3 && m[2] != "" {
					if c, e := strconv.Atoi(m[2]); e == nil {
						colNum = c
					}
				}
			} else if m := yamlLineRegex.FindStringSubmatch(errMsg); len(m) >= 2 {
				if l, e := strconv.Atoi(m[1]); e == nil {
					lineNum = l
				}
			}

			issues = append(issues, GuardIssue{
				File:     filePath,
				Severity: SeverityCritical,
				Line:     lineNum,
				Column:   colNum,
				Message:  errMsg,
				Snippet:  MakeSnippet(content, lineNum),
				Rule:     "yaml_syntax",
			})
			break
		}
	}

	return issues
}

// validateJSON parses JSON strictly and computes error line and column.
func validateJSON(filePath string, content []byte) []GuardIssue {
	var issues []GuardIssue
	trimmed := bytes.TrimSpace(content)
	if len(trimmed) == 0 {
		return issues
	}

	var dummy any
	err := json.Unmarshal(content, &dummy)
	if err != nil {
		lineNum := 1
		colNum := 1

		if syntaxErr, ok := err.(*json.SyntaxError); ok {
			lineNum, colNum = calculateLineColFromOffset(content, int(syntaxErr.Offset))
		}

		issues = append(issues, GuardIssue{
			File:     filePath,
			Severity: SeverityCritical,
			Line:     lineNum,
			Column:   colNum,
			Message:  err.Error(),
			Snippet:  MakeSnippet(content, lineNum),
			Rule:     "json_syntax",
		})
	}

	return issues
}

// validateTOML parses TOML using pelletier/go-toml/v2.
func validateTOML(filePath string, content []byte) []GuardIssue {
	var issues []GuardIssue
	trimmed := bytes.TrimSpace(content)
	if len(trimmed) == 0 {
		return issues
	}

	var dummy any
	err := toml.Unmarshal(content, &dummy)
	if err != nil {
		lineNum := 1
		colNum := 1

		if decodeErr, ok := err.(*toml.DecodeError); ok {
			row, col := decodeErr.Position()
			lineNum = row
			colNum = col
		}

		issues = append(issues, GuardIssue{
			File:     filePath,
			Severity: SeverityCritical,
			Line:     lineNum,
			Column:   colNum,
			Message:  err.Error(),
			Snippet:  MakeSnippet(content, lineNum),
			Rule:     "toml_syntax",
		})
	}

	return issues
}

// validateENV parses .env key-value lines.
func validateENV(filePath string, content []byte) []GuardIssue {
	var issues []GuardIssue
	lines := strings.Split(string(content), "\n")

	for i, rawLine := range lines {
		lineNum := i + 1
		line := strings.TrimSpace(rawLine)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		// Check for missing '='
		if !strings.Contains(line, "=") {
			issues = append(issues, GuardIssue{
				File:     filePath,
				Severity: SeverityCritical,
				Line:     lineNum,
				Column:   1,
				Message:  "Invalid .env line: missing '=' key-value delimiter",
				Snippet:  MakeSnippet(content, lineNum),
				Rule:     "env_delimiter",
			})
			continue
		}

		// Check key
		parts := strings.SplitN(line, "=", 2)
		key := parts[0]
		val := parts[1]

		if strings.TrimSpace(key) != key {
			// Spaces around key before =
			issues = append(issues, GuardIssue{
				File:     filePath,
				Severity: SeverityWarning,
				Line:     lineNum,
				Column:   len(key),
				Message:  "Warning: whitespace around key in .env can cause parsing discrepancies",
				Snippet:  MakeSnippet(content, lineNum),
				Rule:     "env_key_whitespace",
			})
		}

		// Check unclosed quotes in value
		valTrimmed := strings.TrimSpace(val)
		if (strings.HasPrefix(valTrimmed, "\"") && !strings.HasSuffix(valTrimmed, "\"")) ||
			(strings.HasPrefix(valTrimmed, "'") && !strings.HasSuffix(valTrimmed, "'")) {
			if len(valTrimmed) == 1 || !strings.HasSuffix(valTrimmed, string(valTrimmed[0])) {
				issues = append(issues, GuardIssue{
					File:     filePath,
					Severity: SeverityCritical,
					Line:     lineNum,
					Column:   strings.Index(rawLine, "=") + 2,
					Message:  "Unclosed quote in .env variable value",
					Snippet:  MakeSnippet(content, lineNum),
					Rule:     "env_unclosed_quote",
				})
			}
		}
	}

	return issues
}

// validateConf checks brace balance and quotes for nginx/caddy/general conf.
func validateConf(filePath string, content []byte) []GuardIssue {
	var issues []GuardIssue
	lines := strings.Split(string(content), "\n")

	braceDepth := 0
	openBraceLines := []int{}

	for i, rawLine := range lines {
		lineNum := i + 1
		trimmed := strings.TrimSpace(rawLine)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}

		// Count braces while ignoring quotes
		inDoubleQuote := false
		inSingleQuote := false
		isEscaped := false

		for cIdx, ch := range rawLine {
			if ch == '\\' {
				isEscaped = !isEscaped
				continue
			}

			if ch == '"' && !inSingleQuote && !isEscaped {
				inDoubleQuote = !inDoubleQuote
			} else if ch == '\'' && !inDoubleQuote && !isEscaped {
				inSingleQuote = !inSingleQuote
			}
			isEscaped = false

			if !inDoubleQuote && !inSingleQuote {
				if ch == '{' {
					braceDepth++
					openBraceLines = append(openBraceLines, lineNum)
				} else if ch == '}' {
					braceDepth--
					if braceDepth < 0 {
						issues = append(issues, GuardIssue{
							File:     filePath,
							Severity: SeverityCritical,
							Line:     lineNum,
							Column:   cIdx + 1,
							Message:  "Unexpected closing brace '}' without matching opening block",
							Snippet:  MakeSnippet(content, lineNum),
							Rule:     "conf_unmatched_brace",
						})
						braceDepth = 0
					} else if len(openBraceLines) > 0 {
						openBraceLines = openBraceLines[:len(openBraceLines)-1]
					}
				}
			}
		}

		if inDoubleQuote || inSingleQuote {
			issues = append(issues, GuardIssue{
				File:     filePath,
				Severity: SeverityCritical,
				Line:     lineNum,
				Column:   len(rawLine),
				Message:  "Unclosed string literal quote in directive",
				Snippet:  MakeSnippet(content, lineNum),
				Rule:     "conf_unclosed_quote",
			})
		}
	}

	if braceDepth > 0 && len(openBraceLines) > 0 {
		lastOpenLine := openBraceLines[len(openBraceLines)-1]
		issues = append(issues, GuardIssue{
			File:     filePath,
			Severity: SeverityCritical,
			Line:     lastOpenLine,
			Column:   1,
			Message:  fmt.Sprintf("Block opened on line %d is never closed with '}' before EOF", lastOpenLine),
			Snippet:  MakeSnippet(content, lastOpenLine),
			Rule:     "conf_unclosed_block",
		})
	}

	return issues
}

// validateSystemdUnit verifies basic [Section] structure.
func validateSystemdUnit(filePath string, content []byte) []GuardIssue {
	var issues []GuardIssue
	lines := strings.Split(string(content), "\n")
	hasSection := false

	for i, rawLine := range lines {
		lineNum := i + 1
		trimmed := strings.TrimSpace(rawLine)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") || strings.HasPrefix(trimmed, ";") {
			continue
		}

		if strings.HasPrefix(trimmed, "[") && strings.HasSuffix(trimmed, "]") {
			hasSection = true
			continue
		}

		if !hasSection {
			issues = append(issues, GuardIssue{
				File:     filePath,
				Severity: SeverityCritical,
				Line:     lineNum,
				Column:   1,
				Message:  "Systemd directives must be placed inside a section (e.g. [Unit], [Service], [Install])",
				Snippet:  MakeSnippet(content, lineNum),
				Rule:     "systemd_missing_section",
			})
			break
		}

		if !strings.Contains(trimmed, "=") {
			issues = append(issues, GuardIssue{
				File:     filePath,
				Severity: SeverityWarning,
				Line:     lineNum,
				Column:   1,
				Message:  "Directive line without '=' assignment",
				Snippet:  MakeSnippet(content, lineNum),
				Rule:     "systemd_no_equals",
			})
		}
	}

	return issues
}

// MakeSnippet extracts a 3-5 line code snippet surrounding lineNum.
func MakeSnippet(content []byte, targetLine int) string {
	lines := strings.Split(string(content), "\n")
	if len(lines) == 0 {
		return ""
	}

	start := targetLine - 2
	if start < 1 {
		start = 1
	}
	end := targetLine + 2
	if end > len(lines) {
		end = len(lines)
	}

	var sb strings.Builder
	for i := start; i <= end; i++ {
		prefix := "  "
		if i == targetLine {
			prefix = "> "
		}
		sb.WriteString(fmt.Sprintf("%s%3d | %s\n", prefix, i, strings.TrimRight(lines[i-1], "\r\n")))
	}

	return strings.TrimRight(sb.String(), "\n")
}

func calculateLineColFromOffset(content []byte, offset int) (int, int) {
	if offset < 0 {
		return 1, 1
	}
	if offset > len(content) {
		offset = len(content)
	}

	line := 1
	col := 1
	for i := 0; i < offset; i++ {
		if content[i] == '\n' {
			line++
			col = 1
		} else {
			col++
		}
	}
	return line, col
}
