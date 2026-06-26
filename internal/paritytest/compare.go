// Package paritytest is the parity gate: it proves the Go pipeline emits
// byte-identical JSON to the Rust CLI on golden sessions (after recursive
// key-sort normalization). The pipeline lands in W3/W4; until then the gate
// skips (see parity_test.go) while the comparator below is exercised directly.
package paritytest

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math/big"
)

// Canonicalize recursively key-sorts a JSON document so two encoders that
// differ only in object-key order compare equal — the same normalization the
// Rust goldens get via `python3 -m json.tool --sort-keys`. Numbers are decoded
// as json.Number (not float64) to avoid losing precision on u64 token counts
// above 2^53.
//
// ponytail: number *formatting* reconciliation (Rust `0.0` vs Go `0`) is a W4
// concern handled when real floats flow through the gate; this is the
// structural normalizer.
func Canonicalize(b []byte) ([]byte, error) {
	dec := json.NewDecoder(bytes.NewReader(b))
	dec.UseNumber()
	var v any
	if err := dec.Decode(&v); err != nil {
		return nil, fmt.Errorf("canonicalize decode: %w", err)
	}
	// json.Marshal sorts map[string]any keys, recursively.
	return json.Marshal(v)
}

// DiffPath returns "" when golden and got are structurally equal after
// canonicalization, otherwise the JSON path of the first divergence — enough to
// bisect which pipeline stage went wrong (architect M3 / W4-T6).
func DiffPath(golden, got []byte) (string, error) {
	var gv, tv any
	dg := json.NewDecoder(bytes.NewReader(golden))
	dg.UseNumber()
	if err := dg.Decode(&gv); err != nil {
		return "", fmt.Errorf("decode golden: %w", err)
	}
	dt := json.NewDecoder(bytes.NewReader(got))
	dt.UseNumber()
	if err := dt.Decode(&tv); err != nil {
		return "", fmt.Errorf("decode got: %w", err)
	}
	return walk("$", gv, tv), nil
}

func walk(path string, a, b any) string {
	switch av := a.(type) {
	case map[string]any:
		bv, ok := b.(map[string]any)
		if !ok {
			return path + ": type object vs " + typeName(b)
		}
		for k, akv := range av {
			bkv, present := bv[k]
			if !present {
				return path + "." + k + ": missing in got"
			}
			if d := walk(path+"."+k, akv, bkv); d != "" {
				return d
			}
		}
		for k := range bv {
			if _, present := av[k]; !present {
				return path + "." + k + ": extra in got"
			}
		}
		return ""
	case []any:
		bv, ok := b.([]any)
		if !ok {
			return path + ": type array vs " + typeName(b)
		}
		if len(av) != len(bv) {
			return fmt.Sprintf("%s: array len %d vs %d", path, len(av), len(bv))
		}
		for i := range av {
			if d := walk(fmt.Sprintf("%s[%d]", path, i), av[i], bv[i]); d != "" {
				return d
			}
		}
		return ""
	default:
		// Compare numbers numerically (big.Rat is exact for ints and decimals):
		// serde formats whole f64 as `214972.0` where Go emits `214972`, but the
		// values are identical. Strings/bools fall back to textual compare.
		if an, ok := a.(json.Number); ok {
			if bn, ok := b.(json.Number); ok {
				ar, ok1 := new(big.Rat).SetString(an.String())
				br, ok2 := new(big.Rat).SetString(bn.String())
				if ok1 && ok2 {
					if ar.Cmp(br) != 0 {
						return fmt.Sprintf("%s: %v vs %v", path, a, b)
					}
					return ""
				}
			}
		}
		if fmt.Sprint(a) != fmt.Sprint(b) {
			return fmt.Sprintf("%s: %v vs %v", path, a, b)
		}
		return ""
	}
}

func typeName(v any) string {
	switch v.(type) {
	case map[string]any:
		return "object"
	case []any:
		return "array"
	case nil:
		return "null"
	default:
		return fmt.Sprintf("%T", v)
	}
}
