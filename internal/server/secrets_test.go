package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"config-studio/internal/audit"
	"config-studio/internal/config"
	appfs "config-studio/internal/fs"
	"config-studio/internal/plugin"
	"config-studio/internal/secrets"
)

func TestSecretsEndpoints(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "cs-server-secrets-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	cfgMgr, err := config.NewManager(tmpDir)
	if err != nil {
		t.Fatalf("failed to create config manager: %v", err)
	}

	// Enable password auth
	settings := cfgMgr.Get()
	settings.AuthEnabled = true
	settings.AuthUser = "admin"
	settings.AuthPass = "admin123"
	_ = cfgMgr.Update(settings)

	fsSvc, err := appfs.NewService(tmpDir)
	if err != nil {
		t.Fatalf("failed to create fs service: %v", err)
	}

	runner := plugin.NewRunner()
	defer runner.Shutdown()

	pMgr, err := plugin.NewManager(tmpDir, runner)
	if err != nil {
		t.Fatalf("failed to create plugin manager: %v", err)
	}

	auditLogger, err := audit.NewLogger(tmpDir)
	if err != nil {
		t.Fatalf("failed to create audit logger: %v", err)
	}
	defer auditLogger.Close()

	secMgr, err := secrets.NewManager(tmpDir)
	if err != nil {
		t.Fatalf("failed to create secrets manager: %v", err)
	}

	srv := NewServer(Config{}, cfgMgr, fsSvc, pMgr, runner, auditLogger, secMgr)

	// 1. Initial status check
	reqStatus := httptest.NewRequest("GET", "/api/secrets/status", nil)
	reqStatus.Header.Set("X-ConfigStudio-Web", "1")
	recStatus := httptest.NewRecorder()
	srv.ServeHTTP(recStatus, reqStatus)

	if recStatus.Code != http.StatusOK {
		t.Fatalf("expected 200 OK from /api/secrets/status, got %d", recStatus.Code)
	}
	var status secrets.StoreStatus
	_ = json.Unmarshal(recStatus.Body.Bytes(), &status)
	if !status.AuthEnabled {
		t.Fatalf("expected authEnabled: true")
	}
	if status.PrivilegedActive {
		t.Fatalf("expected privilegedActive: false")
	}

	// 2. Log in with regular admin credentials to obtain session cookie
	loginBody, _ := json.Marshal(map[string]string{
		"username": "admin",
		"password": "admin123",
	})
	reqLogin := httptest.NewRequest("POST", "/api/auth/login", bytes.NewReader(loginBody))
	reqLogin.Header.Set("X-ConfigStudio-Web", "1")
	recLogin := httptest.NewRecorder()
	srv.ServeHTTP(recLogin, reqLogin)

	if recLogin.Code != http.StatusOK {
		t.Fatalf("expected 200 OK from login, got %d", recLogin.Code)
	}

	cookies := recLogin.Result().Cookies()
	var sessionCookie *http.Cookie
	for _, c := range cookies {
		if c.Name == "cs_session" {
			sessionCookie = c
			break
		}
	}
	if sessionCookie == nil {
		t.Fatalf("expected cs_session cookie from login")
	}

	// 3. Try to save secret without unlocking privileged mode -> MUST return 403 Forbidden
	saveBody, _ := json.Marshal(map[string]any{
		"id":    "shared:db-pass",
		"title": "Database Password",
		"type":  "password",
		"scope": "shared",
		"value": "SecretDbPass456!",
	})
	reqSaveBlocked := httptest.NewRequest("POST", "/api/secrets/save", bytes.NewReader(saveBody))
	reqSaveBlocked.Header.Set("X-ConfigStudio-Web", "1")
	reqSaveBlocked.AddCookie(sessionCookie)
	recSaveBlocked := httptest.NewRecorder()
	srv.ServeHTTP(recSaveBlocked, reqSaveBlocked)

	if recSaveBlocked.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden when locked, got %d", recSaveBlocked.Code)
	}

	// 4. Unlock with wrong password -> MUST return 401
	unlockWrong, _ := json.Marshal(map[string]string{"password": "wrong"})
	reqUnlockWrong := httptest.NewRequest("POST", "/api/secrets/unlock", bytes.NewReader(unlockWrong))
	reqUnlockWrong.Header.Set("X-ConfigStudio-Web", "1")
	reqUnlockWrong.AddCookie(sessionCookie)
	recUnlockWrong := httptest.NewRecorder()
	srv.ServeHTTP(recUnlockWrong, reqUnlockWrong)

	if recUnlockWrong.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 Unauthorized for wrong pass, got %d", recUnlockWrong.Code)
	}

	// 5. Unlock with correct password -> MUST return 200
	unlockOk, _ := json.Marshal(map[string]string{"password": "admin123"})
	reqUnlockOk := httptest.NewRequest("POST", "/api/secrets/unlock", bytes.NewReader(unlockOk))
	reqUnlockOk.Header.Set("X-ConfigStudio-Web", "1")
	reqUnlockOk.AddCookie(sessionCookie)
	recUnlockOk := httptest.NewRecorder()
	srv.ServeHTTP(recUnlockOk, reqUnlockOk)

	if recUnlockOk.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for correct pass, got %d", recUnlockOk.Code)
	}

	// 6. Now save secret with privileged session -> MUST return 200 OK
	reqSaveOk := httptest.NewRequest("POST", "/api/secrets/save", bytes.NewReader(saveBody))
	reqSaveOk.Header.Set("X-ConfigStudio-Web", "1")
	reqSaveOk.AddCookie(sessionCookie)
	recSaveOk := httptest.NewRecorder()
	srv.ServeHTTP(recSaveOk, reqSaveOk)

	if recSaveOk.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for saving secret, got %d: %s", recSaveOk.Code, recSaveOk.Body.String())
	}

	// 6. List secrets
	reqList := httptest.NewRequest("GET", "/api/secrets", nil)
	reqList.Header.Set("X-ConfigStudio-Web", "1")
	reqList.AddCookie(sessionCookie)
	recList := httptest.NewRecorder()
	srv.ServeHTTP(recList, reqList)

	if recList.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for list secrets, got %d", recList.Code)
	}
	var metaList []secrets.SecretMeta
	_ = json.Unmarshal(recList.Body.Bytes(), &metaList)
	if len(metaList) != 1 || metaList[0].ID != "shared:db-pass" {
		t.Fatalf("expected 1 secret with id 'shared:db-pass', got %v", metaList)
	}

	// 7. Reveal secret value (get)
	getBody, _ := json.Marshal(map[string]string{"id": "shared:db-pass"})
	reqGet := httptest.NewRequest("POST", "/api/secrets/get", bytes.NewReader(getBody))
	reqGet.Header.Set("X-ConfigStudio-Web", "1")
	reqGet.AddCookie(sessionCookie)
	recGet := httptest.NewRecorder()
	srv.ServeHTTP(recGet, reqGet)

	if recGet.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for getting secret value, got %d", recGet.Code)
	}
	var valResp map[string]string
	_ = json.Unmarshal(recGet.Body.Bytes(), &valResp)
	if valResp["value"] != "SecretDbPass456!" {
		t.Fatalf("expected value 'SecretDbPass456!', got '%s'", valResp["value"])
	}

	// 8. Delete secret
	reqDel := httptest.NewRequest("DELETE", "/api/secrets/shared:db-pass", nil)
	reqDel.Header.Set("X-ConfigStudio-Web", "1")
	reqDel.AddCookie(sessionCookie)
	recDel := httptest.NewRecorder()
	srv.ServeHTTP(recDel, reqDel)

	if recDel.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for delete, got %d", recDel.Code)
	}

	// Verify it's gone
	if secMgr.Has("shared:db-pass") {
		t.Fatalf("secret should be deleted")
	}
}

func TestSecrets_AutoGenerateIDFromTitle(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "cs-server-secrets-auto-id-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	cfgMgr, _ := config.NewManager(tmpDir)
	fsSvc, _ := appfs.NewService(tmpDir)
	runner := plugin.NewRunner()
	defer runner.Shutdown()
	pMgr, _ := plugin.NewManager(tmpDir, runner)
	auditLogger, _ := audit.NewLogger(tmpDir)
	defer auditLogger.Close()
	secMgr, _ := secrets.NewManager(tmpDir)

	srv := NewServer(Config{}, cfgMgr, fsSvc, pMgr, runner, auditLogger, secMgr)

	// User provides empty ID, title "1111"
	saveBody, _ := json.Marshal(map[string]any{
		"id":    "",
		"title": "1111",
		"type":  "password",
		"scope": "shared",
		"value": "MyPass123",
	})
	req := httptest.NewRequest("POST", "/api/secrets/save", bytes.NewReader(saveBody))
	req.Header.Set("X-ConfigStudio-Web", "1")
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK with auto-generated ID, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	generatedID, _ := resp["id"].(string)
	if generatedID == "" {
		t.Fatalf("expected non-empty generated ID, got empty")
	}
	if !secMgr.Has(generatedID) {
		t.Fatalf("expected secret with id %q to exist in vault", generatedID)
	}
}
