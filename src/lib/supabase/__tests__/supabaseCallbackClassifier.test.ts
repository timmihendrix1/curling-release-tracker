// Exhaustive branch coverage for the pure OAuth-return classifier and URL
// cleanup (supabaseCallbackClassifier.ts; ADR-0025 Decision 12 and §D).
//
// This layer classifies SHAPE only. It is deliberately given no notion of a
// persisted attempt or of whether an exchange may occur — those are the
// coordinator's, and no test here asserts anything about them.
import { describe, expect, it } from "vitest";
import {
  classifyCallbackUrl,
  cleanCallbackUrl,
  isValidFlowSelector,
  OWNED_CALLBACK_QUERY_FIELDS,
  OWNED_IMPLICIT_FRAGMENT_FIELDS,
} from "../supabaseCallbackClassifier";

const BASE = "https://app.example.test/";
const FLOW_ID = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const CODE = "b7c1e2f3-4a5b-6c7d-8e9f-0a1b2c3d4e5f";

function url(query: string, fragment = ""): string {
  return `${BASE}${query ? `?${query}` : ""}${fragment}`;
}

describe("the owned field sets are exactly what ADR-0025 §D specifies", () => {
  it("owns exactly five query fields, and `state` is not one of them", () => {
    expect([...OWNED_CALLBACK_QUERY_FIELDS]).toEqual([
      "code",
      "sb_flow_id",
      "error",
      "error_description",
      "error_code",
    ]);
    expect(OWNED_CALLBACK_QUERY_FIELDS).not.toContain("state");
  });

  it("owns exactly ten implicit-grant fragment fields", () => {
    expect([...OWNED_IMPLICIT_FRAGMENT_FIELDS]).toEqual([
      "provider_token",
      "provider_refresh_token",
      "access_token",
      "refresh_token",
      "expires_in",
      "expires_at",
      "token_type",
      "error",
      "error_description",
      "error_code",
    ]);
  });
});

describe("isValidFlowSelector", () => {
  it("accepts the provider's own selector shape and rejects everything else", () => {
    expect(isValidFlowSelector(FLOW_ID)).toBe(true);
    expect(isValidFlowSelector("abcd1234")).toBe(true);
    expect(isValidFlowSelector("a_b-c1234")).toBe(true);
    for (const bad of [null, undefined, 42, "", "short", "x".repeat(65), "has space", "has!bang", "a.b.c"]) {
      expect(isValidFlowSelector(bad), String(bad)).toBe(false);
    }
  });
});

describe("classifyCallbackUrl — no_return", () => {
  it("classifies a plain URL with no owned material as no_return", () => {
    expect(classifyCallbackUrl(BASE)).toEqual({ shape: "no_return" });
  });

  it("classifies unrelated query parameters as no_return", () => {
    expect(classifyCallbackUrl(url("state=abc&inviteToken=tok&adminRequestId=req-1"))).toEqual({
      shape: "no_return",
    });
  });

  it("classifies an ordinary anchor fragment as no_return", () => {
    expect(classifyCallbackUrl(url("", "#warmup"))).toEqual({ shape: "no_return" });
  });
});

describe("classifyCallbackUrl — success_candidate", () => {
  it("classifies exactly one valid code plus exactly one valid selector as a success candidate", () => {
    expect(classifyCallbackUrl(url(`code=${CODE}&sb_flow_id=${FLOW_ID}`))).toEqual({
      shape: "success_candidate",
      flowId: FLOW_ID,
      authorizationCode: CODE,
    });
  });

  it("still classifies a success candidate when unrelated parameters travel alongside", () => {
    expect(
      classifyCallbackUrl(url(`state=xyz&code=${CODE}&inviteToken=tok&sb_flow_id=${FLOW_ID}`))
    ).toEqual({ shape: "success_candidate", flowId: FLOW_ID, authorizationCode: CODE });
  });
});

describe("classifyCallbackUrl — provider_error_candidate", () => {
  it("classifies each error field on its own (with a selector, without a code)", () => {
    for (const field of ["error", "error_description", "error_code"]) {
      expect(classifyCallbackUrl(url(`${field}=access_denied&sb_flow_id=${FLOW_ID}`)), field).toEqual({
        shape: "provider_error_candidate",
        flowId: FLOW_ID,
      });
    }
  });

  it("carries only the validated selector — never the raw provider error values", () => {
    const shape = classifyCallbackUrl(
      url(`error=server_error&error_description=Something%20leaky&error_code=500&sb_flow_id=${FLOW_ID}`)
    );
    expect(shape).toEqual({ shape: "provider_error_candidate", flowId: FLOW_ID });
    expect(JSON.stringify(shape)).not.toContain("Something leaky");
    expect(JSON.stringify(shape)).not.toContain("server_error");
  });
});

describe("classifyCallbackUrl — ambiguous_callback", () => {
  it("classifies a code together with any error field as ambiguous", () => {
    for (const field of ["error", "error_description", "error_code"]) {
      expect(
        classifyCallbackUrl(url(`code=${CODE}&sb_flow_id=${FLOW_ID}&${field}=access_denied`)),
        field
      ).toEqual({ shape: "ambiguous_callback" });
    }
  });

  it("classifies a duplicate occurrence of EACH owned field as ambiguous", () => {
    const duplicates: Record<string, string> = {
      code: `code=${CODE}&code=${CODE}&sb_flow_id=${FLOW_ID}`,
      sb_flow_id: `code=${CODE}&sb_flow_id=${FLOW_ID}&sb_flow_id=${FLOW_ID}`,
      error: `error=a&error=b&sb_flow_id=${FLOW_ID}`,
      error_description: `error_description=a&error_description=b&sb_flow_id=${FLOW_ID}`,
      error_code: `error_code=a&error_code=b&sb_flow_id=${FLOW_ID}`,
    };
    // Every owned field is covered, so adding a sixth field cannot silently
    // escape this check.
    expect(Object.keys(duplicates).sort()).toEqual([...OWNED_CALLBACK_QUERY_FIELDS].sort());
    for (const [field, query] of Object.entries(duplicates)) {
      expect(classifyCallbackUrl(url(query)), field).toEqual({ shape: "ambiguous_callback" });
    }
  });

  it("classifies a duplicate as ambiguous even when the duplicated value is itself invalid", () => {
    expect(classifyCallbackUrl(url(`code=${CODE}&sb_flow_id=bad!&sb_flow_id=${FLOW_ID}`))).toEqual({
      shape: "ambiguous_callback",
    });
  });
});

describe("classifyCallbackUrl — malformed_callback", () => {
  it("classifies a selector with neither a code nor an error as malformed", () => {
    expect(classifyCallbackUrl(url(`sb_flow_id=${FLOW_ID}`))).toEqual({
      shape: "malformed_callback",
    });
  });

  it("classifies a code without a selector as malformed", () => {
    expect(classifyCallbackUrl(url(`code=${CODE}`))).toEqual({ shape: "malformed_callback" });
  });

  it("classifies an error without a selector as malformed", () => {
    expect(classifyCallbackUrl(url("error=access_denied"))).toEqual({
      shape: "malformed_callback",
    });
  });

  it("classifies an invalid selector as malformed", () => {
    for (const selector of ["", "short", "x".repeat(65), "not%20valid%21"]) {
      expect(classifyCallbackUrl(url(`code=${CODE}&sb_flow_id=${selector}`)), selector).toEqual({
        shape: "malformed_callback",
      });
    }
  });

  it("classifies an empty or whitespace-bearing code as malformed", () => {
    for (const code of ["", "has%20space", "has%0anewline"]) {
      expect(classifyCallbackUrl(url(`code=${code}&sb_flow_id=${FLOW_ID}`)), code).toEqual({
        shape: "malformed_callback",
      });
    }
  });

  it("classifies an absurdly long code as malformed", () => {
    expect(classifyCallbackUrl(url(`code=${"a".repeat(2049)}&sb_flow_id=${FLOW_ID}`))).toEqual({
      shape: "malformed_callback",
    });
  });

  it("classifies an unparseable URL as malformed rather than throwing", () => {
    expect(classifyCallbackUrl("not-a-url")).toEqual({ shape: "malformed_callback" });
    expect(classifyCallbackUrl("")).toEqual({ shape: "malformed_callback" });
  });

  it("classifies EACH owned implicit-grant fragment field as malformed, whatever else is present", () => {
    for (const field of OWNED_IMPLICIT_FRAGMENT_FIELDS) {
      expect(classifyCallbackUrl(url("", `#${field}=value`)), field).toEqual({
        shape: "malformed_callback",
      });
      // An owned implicit fragment dominates even an otherwise-valid success
      // query: a PKCE client must never consume an implicit-grant response.
      expect(
        classifyCallbackUrl(url(`code=${CODE}&sb_flow_id=${FLOW_ID}`, `#${field}=value`)),
        `${field} + success query`
      ).toEqual({ shape: "malformed_callback" });
    }
  });

  it("treats an owned implicit fragment key with no value as present", () => {
    expect(classifyCallbackUrl(url("", "#access_token"))).toEqual({
      shape: "malformed_callback",
    });
  });
});

describe("cleanCallbackUrl — what survives", () => {
  it("leaves a URL with nothing owned byte-for-byte unchanged", () => {
    const untouched = url("state=abc&inviteToken=tok%20en&adminRequestId=req-1", "#warmup");
    expect(cleanCallbackUrl(untouched)).toBe(untouched);
  });

  it("preserves state, inviteToken, adminRequestId and any other unrelated parameter", () => {
    const cleaned = cleanCallbackUrl(
      url(`state=abc&code=${CODE}&inviteToken=tok&sb_flow_id=${FLOW_ID}&adminRequestId=req-1&other=7`)
    );
    const params = new URL(cleaned).searchParams;
    expect(params.get("state")).toBe("abc");
    expect(params.get("inviteToken")).toBe("tok");
    expect(params.get("adminRequestId")).toBe("req-1");
    expect(params.get("other")).toBe("7");
    for (const field of OWNED_CALLBACK_QUERY_FIELDS) {
      expect(params.has(field), field).toBe(false);
    }
  });

  it("removes ALL occurrences of ALL five owned fields", () => {
    const query = [...OWNED_CALLBACK_QUERY_FIELDS]
      .flatMap((field) => [`${field}=one`, `${field}=two`])
      .concat("state=kept")
      .join("&");

    const cleaned = cleanCallbackUrl(url(query));

    expect(new URL(cleaned).search).toBe("?state=kept");
  });

  it("preserves an unrelated anchor fragment while removing owned query material", () => {
    const cleaned = cleanCallbackUrl(url(`code=${CODE}&sb_flow_id=${FLOW_ID}`, "#warmup"));
    expect(new URL(cleaned).hash).toBe("#warmup");
    expect(new URL(cleaned).search).toBe("");
  });

  it("clears the WHOLE fragment for each owned implicit-grant field, keeping unrelated query parameters", () => {
    for (const field of OWNED_IMPLICIT_FRAGMENT_FIELDS) {
      const cleaned = cleanCallbackUrl(url("state=kept", `#${field}=secret&other_fragment=x`));
      expect(new URL(cleaned).hash, field).toBe("");
      expect(cleaned, field).not.toContain("secret");
      expect(cleaned, field).not.toContain("other_fragment");
      expect(new URL(cleaned).searchParams.get("state"), field).toBe("kept");
    }
  });

  it("returns an unparseable URL unchanged instead of throwing", () => {
    expect(cleanCallbackUrl("not-a-url")).toBe("not-a-url");
  });

  it("removes the query string entirely when only owned fields were present", () => {
    expect(cleanCallbackUrl(url(`code=${CODE}&sb_flow_id=${FLOW_ID}`))).toBe(BASE);
  });
});
