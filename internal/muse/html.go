package muse

import (
	xhtml "golang.org/x/net/html"
	"golang.org/x/net/html/atom"
	"html"
	"strings"
)

// SafeHTML rebuilds formatting from an allowlist; no source attributes, CSS,
// scripts, embeds, mention links, or remote image loads reach the Matrix client.
func SafeHTML(input string) string {
	root := &xhtml.Node{Type: xhtml.ElementNode, Data: "div", DataAtom: atom.Div}
	nodes, err := xhtml.ParseFragment(strings.NewReader(input), root)
	if err != nil {
		return ""
	}
	var out strings.Builder
	var visit func(*xhtml.Node, int)
	visit = func(n *xhtml.Node, depth int) {
		if depth > 64 {
			return
		}
		if n.Type == xhtml.TextNode {
			out.WriteString(html.EscapeString(n.Data))
			return
		}
		if n.Type != xhtml.ElementNode {
			return
		}
		switch n.Data {
		case "script", "style", "iframe", "object", "svg", "button", "form", "input", "textarea", "img":
			return
		}
		allowed := strings.Contains("|p|br|strong|b|em|i|u|del|s|code|pre|blockquote|ul|ol|li|h1|h2|h3|h4|h5|h6|table|thead|tbody|tr|th|td|hr|", "|"+n.Data+"|")
		href := ""
		if n.Data == "a" {
			for _, a := range n.Attr {
				if a.Key == "href" && SafeURL(a.Val) && !strings.HasPrefix(a.Val, "https://matrix.to/") {
					href = a.Val
					allowed = true
				}
			}
		}
		if allowed {
			out.WriteString("<" + n.Data)
			if href != "" {
				out.WriteString(` href="` + html.EscapeString(href) + `"`)
			}
			out.WriteString(">")
		}
		for child := n.FirstChild; child != nil; child = child.NextSibling {
			visit(child, depth+1)
		}
		if allowed && n.Data != "br" && n.Data != "hr" {
			out.WriteString("</" + n.Data + ">")
		}
	}
	for _, n := range nodes {
		visit(n, 0)
	}
	return out.String()
}
