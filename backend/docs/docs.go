// Package docs embeds the OpenAPI specification.
package docs

import _ "embed"

//go:embed openapi.yaml
var OpenAPISpec []byte
