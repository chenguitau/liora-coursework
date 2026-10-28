package db

import (
	"strconv"
	"strings"
)

// likeEscape escapes the LIKE metacharacters in a user keyword so that it is
// matched as literal text.
func likeEscape(s string) string {
	return strings.NewReplacer("\\", "\\\\", "%", "\\%", "_", "\\_").Replace(s)
}

// likePredicate appends the "contains" pattern for q to args and returns the
// complete "<expr> LIKE $n ESCAPE '\'" predicate bound to it.
//
// Every LIKE over user text must be built here (or with likeEscape plus an
// explicit ESCAPE declaration, for static queries): the escaping above only
// means anything together with ESCAPE, and a missing ESCAPE fails silently --
// the pattern then searches for literal backslashes and matches nothing.
func likePredicate(expr string, args *[]any, q string) string {
	*args = append(*args, "%"+likeEscape(q)+"%")
	return expr + " LIKE $" + strconv.Itoa(len(*args)) + " ESCAPE '\\'"
}
