//go:build embedui

package server

import (
	"embed"
	"io/fs"
	"net/http"
)

// webuiDist contains the Rsbuild output copied from web/dist by build.sh.
//
//go:embed all:webui/dist
var webuiDist embed.FS

func (s *Server) webuiHandler() http.Handler {
	root, err := fs.Sub(webuiDist, "webui/dist")
	if err != nil {
		panic(err)
	}
	handler, err := newWebUIHandler(root)
	if err != nil {
		panic(err)
	}
	return handler
}
