package server

import (
	"compress/gzip"
	"io"
	"net/http"
	"strings"
	"sync"
)

var gzipWriterPool = sync.Pool{
	New: func() any {
		w, _ := gzip.NewWriterLevel(io.Discard, gzip.BestSpeed)
		return w
	},
}

type gzipResponseWriter struct {
	http.ResponseWriter
	writer      *gzip.Writer
	status      int
	wroteHeader bool
}

func (w *gzipResponseWriter) isGzipDisabled() bool {
	return w.status == http.StatusNoContent || w.status == http.StatusNotModified || (w.status >= 100 && w.status < 200)
}

func (w *gzipResponseWriter) WriteHeader(status int) {
	if w.wroteHeader {
		return
	}
	w.wroteHeader = true
	w.status = status

	if w.isGzipDisabled() {
		w.ResponseWriter.WriteHeader(status)
		return
	}

	// If no Content-Type was set, detect or allow standard library to set
	// Delete Content-Length because length changes after gzip compression
	w.Header().Del("Content-Length")
	w.Header().Set("Content-Encoding", "gzip")
	w.Header().Add("Vary", "Accept-Encoding")

	w.ResponseWriter.WriteHeader(status)
}

func (w *gzipResponseWriter) Write(b []byte) (int, error) {
	if !w.wroteHeader {
		w.WriteHeader(http.StatusOK)
	}
	if w.isGzipDisabled() {
		return 0, nil
	}
	return w.writer.Write(b)
}

// Flush implements http.Flusher
func (w *gzipResponseWriter) Flush() {
	if w.writer != nil && !w.isGzipDisabled() {
		_ = w.writer.Flush()
	}
	if flusher, ok := w.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

// gzipMiddleware compresses HTTP responses when the client supports gzip encoding.
func (s *Server) gzipMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Skip gzip if client doesn't support it
		if !strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
			next.ServeHTTP(w, r)
			return
		}

		// Skip gzip for SSE or WebSocket upgrades
		if r.Header.Get("Upgrade") != "" || strings.Contains(r.Header.Get("Accept"), "text/event-stream") {
			next.ServeHTTP(w, r)
			return
		}

		gz := gzipWriterPool.Get().(*gzip.Writer)
		defer gzipWriterPool.Put(gz)
		gz.Reset(w)

		gzw := &gzipResponseWriter{
			ResponseWriter: w,
			writer:         gz,
			status:         http.StatusOK,
		}

		defer func() {
			if !gzw.isGzipDisabled() && gzw.wroteHeader {
				_ = gz.Close()
			}
		}()

		next.ServeHTTP(gzw, r)
	})
}
