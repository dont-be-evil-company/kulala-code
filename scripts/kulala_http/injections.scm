; Kulala injection queries (overlay on tree-sitter-kulala-http).

; Comments
((comment) @injection.content
  (#set! injection.language "comment"))

; Body
((json_body) @injection.content
  (#set! injection.language "json"))

((xml_body) @injection.content
  (#set! injection.language "xml"))

((graphql_data) @injection.content
  (#set! injection.language "graphql"))

; Inline script (JavaScript only)
((script
  (script_body) @injection.content) @_script
  (#set! injection.include-children)
  (#set! injection.language "javascript"))
