package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestTokenGuard(t *testing.T) {
	s := &server{port: 7878, token: newToken()}
	h := s.guard(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) }))
	do := func(method, target string, cookie *http.Cookie) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, target, nil)
		r.Host = "127.0.0.1:7878"
		r.Header.Set("X-Spline", "1")
		if cookie != nil {
			r.AddCookie(cookie)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}

	if w := do("GET", "/api/file", nil); w.Code != http.StatusForbidden {
		t.Fatalf("API without key: %d, want 403", w.Code)
	}
	if w := do("GET", "/js/app.js", nil); w.Code != http.StatusOK {
		t.Fatalf("static file without key: %d, want 200", w.Code)
	}
	if w := do("GET", "/?k=wrong", nil); w.Code != http.StatusForbidden {
		t.Fatalf("wrong key: %d, want 403", w.Code)
	}
	w := do("GET", "/?k="+s.token+"&lang=en", nil)
	if w.Code != http.StatusSeeOther || w.Header().Get("Location") != "/?lang=en" {
		t.Fatalf("key in address: %d to %q, want 303 to /?lang=en", w.Code, w.Header().Get("Location"))
	}
	cookies := w.Result().Cookies()
	if len(cookies) != 1 || !cookies[0].HttpOnly || cookies[0].Name != "spline_k_7878" {
		t.Fatalf("cookie: %+v", cookies)
	}
	if w := do("POST", "/api/ping", cookies[0]); w.Code != http.StatusOK {
		t.Fatalf("API with cookie: %d, want 200", w.Code)
	}
	if w := do("POST", "/api/ping", &http.Cookie{Name: "spline_k_7878", Value: "nope"}); w.Code != http.StatusForbidden {
		t.Fatalf("API with a wrong cookie: %d, want 403", w.Code)
	}
}
