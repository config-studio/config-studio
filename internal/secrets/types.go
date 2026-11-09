package secrets

type SecretType string

const (
	TypePassword    SecretType = "password"
	TypeSSHKey      SecretType = "ssh_key"
	TypeToken       SecretType = "token"
	TypeCertificate SecretType = "certificate"
	TypeEnv         SecretType = "env"
	TypeOther       SecretType = "other"
)

type SecretScope string

const (
	ScopeShared SecretScope = "shared"
	ScopePlugin SecretScope = "plugin"
)

type SecretMeta struct {
	ID        string      `json:"id"`
	Title     string      `json:"title"`
	Type      SecretType  `json:"type"`
	Scope     SecretScope `json:"scope"`
	PluginID  string      `json:"pluginId,omitempty"`
	CreatedAt string      `json:"createdAt"`
	UpdatedAt string      `json:"updatedAt"`
}

type SecretItem struct {
	SecretMeta
	Value string `json:"value,omitempty"`
}

type StoreStatus struct {
	Backend          string `json:"backend"`
	IsAvailable      bool   `json:"isAvailable"`
	Count            int    `json:"count"`
	AuthEnabled      bool   `json:"authEnabled"`
	PrivilegedActive bool   `json:"privilegedActive"`
}
