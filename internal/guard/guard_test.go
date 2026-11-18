package guard

import (
	"strings"
	"testing"
)

func TestIsSensitive(t *testing.T) {
	tests := []struct {
		path      string
		userRules []string
		expected  bool
	}{
		{"docker-compose.yml", nil, true},
		{"docker-compose.prod.yaml", nil, true},
		{"compose.yaml", nil, true},
		{"Dockerfile", nil, true},
		{"nginx.conf", nil, true},
		{"/etc/nginx/sites-available/default", nil, true},
		{"conf.d/upstream.conf", nil, true},
		{"Caddyfile", nil, true},
		{"traefik.yaml", nil, true},
		{"my-app.service", nil, true},
		{".env.production", nil, true},
		{"app.prod.env", nil, true},
		{"prod.yaml", nil, true},
		{"config.json", nil, false},
		{"notes.txt", nil, false},
		{"custom.prod.json", []string{"*.prod.json"}, true},
	}

	for _, tt := range tests {
		got := IsSensitive(tt.path, tt.userRules, nil)
		if got != tt.expected {
			t.Errorf("IsSensitive(%q) = %v, expected %v", tt.path, got, tt.expected)
		}
	}

	// Test manual override
	overrideTrue := true
	if !IsSensitive("notes.txt", nil, &overrideTrue) {
		t.Errorf("expected overrideTrue to force true")
	}

	overrideFalse := false
	if IsSensitive("docker-compose.yml", nil, &overrideFalse) {
		t.Errorf("expected overrideFalse to force false")
	}
}

func TestValidateYAML_Valid(t *testing.T) {
	yamlContent := []byte(`
version: '3.8'
services:
  web:
    image: nginx:alpine
    ports:
      - "80:80"
`)
	res := Validate("docker-compose.yml", yamlContent)
	if !res.Valid {
		t.Fatalf("expected valid YAML, got issues: %+v", res.Issues)
	}
}

func TestValidateYAML_SyntaxError(t *testing.T) {
	brokenYAML := []byte(`
version: '3.8'
services:
  web:
    image nginx:alpine
    ports:
`)
	res := Validate("docker-compose.yml", brokenYAML)
	if res.Valid {
		t.Fatalf("expected syntax error, got valid")
	}
	if len(res.Issues) == 0 {
		t.Fatalf("expected issues to be populated")
	}
	if res.Issues[0].Severity != SeverityCritical {
		t.Errorf("expected SeverityCritical, got %s", res.Issues[0].Severity)
	}
}

func TestValidateYAML_TabIndentation(t *testing.T) {
	tabYAML := []byte("version: '3.8'\nservices:\n\tweb:\n    image: nginx\n")
	res := Validate("docker-compose.yml", tabYAML)
	if res.Valid {
		t.Fatalf("expected error on tab indentation, got valid")
	}
	if res.Issues[0].Rule != "yaml_no_tabs" {
		t.Errorf("expected yaml_no_tabs, got %s", res.Issues[0].Rule)
	}
}

func TestValidateJSON_ValidAndInvalid(t *testing.T) {
	validJSON := []byte(`{"name": "test", "active": true, "ports": [80, 443]}`)
	resValid := Validate("config.json", validJSON)
	if !resValid.Valid {
		t.Fatalf("expected valid JSON, got: %+v", resValid.Issues)
	}

	brokenJSON := []byte(`{"name": "test", "active": true,}`)
	resBroken := Validate("config.json", brokenJSON)
	if resBroken.Valid {
		t.Fatalf("expected broken JSON with trailing comma to fail")
	}
	if resBroken.Issues[0].Rule != "json_syntax" {
		t.Errorf("expected json_syntax, got %s", resBroken.Issues[0].Rule)
	}
}

func TestValidateTOML_ValidAndInvalid(t *testing.T) {
	validTOML := []byte(`
[server]
port = 8080
host = "127.0.0.1"
`)
	resValid := Validate("config.toml", validTOML)
	if !resValid.Valid {
		t.Fatalf("expected valid TOML, got: %+v", resValid.Issues)
	}

	brokenTOML := []byte(`
[server
port = 8080
`)
	resBroken := Validate("config.toml", brokenTOML)
	if resBroken.Valid {
		t.Fatalf("expected broken TOML with unclosed section to fail")
	}
}

func TestValidateENV_DelimiterAndQuotes(t *testing.T) {
	validENV := []byte(`
# Application config
APP_ENV=production
PORT=8080
SECRET="super secret string"
`)
	resValid := Validate(".env.production", validENV)
	if !resValid.Valid {
		t.Fatalf("expected valid ENV, got: %+v", resValid.Issues)
	}

	brokenENV := []byte(`
APP_ENV=production
BROKEN_LINE_NO_EQUALS
`)
	resBroken := Validate(".env.production", brokenENV)
	if resBroken.Valid {
		t.Fatalf("expected broken ENV to fail")
	}
	if resBroken.Issues[0].Rule != "env_delimiter" {
		t.Errorf("expected env_delimiter, got %s", resBroken.Issues[0].Rule)
	}

	unclosedQuoteENV := []byte(`SECRET="unclosed quote string`)
	resQuote := Validate(".env.production", unclosedQuoteENV)
	if resQuote.Valid {
		t.Fatalf("expected unclosed quote ENV to fail")
	}
	if resQuote.Issues[0].Rule != "env_unclosed_quote" {
		t.Errorf("expected env_unclosed_quote, got %s", resQuote.Issues[0].Rule)
	}
}

func TestValidateConf_UnclosedBrace(t *testing.T) {
	brokenNginx := []byte(`
server {
    listen 80;
    server_name example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
`)
	res := Validate("nginx.conf", brokenNginx)
	if res.Valid {
		t.Fatalf("expected unclosed brace in nginx.conf to fail")
	}
	if res.Issues[0].Rule != "conf_unclosed_block" {
		t.Errorf("expected conf_unclosed_block, got %s", res.Issues[0].Rule)
	}
}

func TestMakeSnippet(t *testing.T) {
	content := []byte("line 1\nline 2\nline 3\nline 4\nline 5\nline 6")
	snippet := MakeSnippet(content, 3)
	if !strings.Contains(snippet, ">   3 | line 3") {
		t.Errorf("expected snippet to contain line 3 marker, got:\n%s", snippet)
	}
}

func TestValidateConf_EscapedQuotesInDirective(t *testing.T) {
	nginxWithEscapedQuotes := []byte(`
server {
    listen 80;
    server_name example.com;

    location / {
        proxy_set_header X-Custom "string with \" escaped quote and {brace}";
        proxy_pass http://127.0.0.1:3000;
    }
}
`)
	res := Validate("nginx.conf", nginxWithEscapedQuotes)
	if !res.Valid {
		t.Fatalf("expected valid conf with escaped quotes, but got issues: %+v", res.Issues)
	}
}

func TestIsSensitive_GlobSegmentBoundary(t *testing.T) {
	rules := []string{"etc/**"}

	// Must match true path segments
	if !IsSensitive("/etc/nginx/nginx.conf", rules, nil) {
		t.Errorf("expected /etc/nginx/nginx.conf to match etc/**")
	}
	if !IsSensitive("etc/my.conf", rules, nil) {
		t.Errorf("expected etc/my.conf to match etc/**")
	}

	// Must NOT match partial substrings
	if IsSensitive("/var/log/stretcher.log", rules, nil) {
		t.Errorf("expected /var/log/stretcher.log NOT to match etc/**")
	}
	if IsSensitive("/home/user/sketch/sketch.conf", rules, nil) {
		t.Errorf("expected sketch.conf NOT to match etc/**")
	}
}
