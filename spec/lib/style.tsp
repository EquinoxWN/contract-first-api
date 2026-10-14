import "@typespec/http";

using Http;

/**
 * Building blocks of the house style guide (docs/style-guide.md). Using them makes a new
 * operation follow the pagination and error rules by construction; Spectral then checks the
 * emitted OpenAPI so a hand-written exception cannot slip through.
 */
namespace ContractFirst.Style;

// Types outside the service namespace are emitted with dotted names
// (ContractFirst.Style.ProblemDetails), so each one shared here is named explicitly.

/** Cursor pagination parameters shared by every list operation. */
@friendlyName("PageParameters")
model PageParameters {
  /** Most items to return on one page. */
  @query
  @pageSize
  @minValue(1)
  @maxValue(100)
  limit?: int32 = 20;

  /** Opaque cursor copied from the `nextCursor` of the previous page. */
  @query
  @continuationToken
  @maxLength(512)
  cursor?: string;
}

/** One page of a list, with the cursor for the next page. */
@friendlyName("{name}Page", Item)
model Page<Item> {
  /** Items on this page, at most `limit`. */
  @pageItems
  @maxItems(100)
  items: Item[];

  /** Cursor for the next page; absent on the last page. */
  @continuationToken
  nextCursor?: string;
}

/** Problem details for HTTP APIs (RFC 9457). */
@friendlyName("ProblemDetails")
model ProblemDetails {
  /** URI reference that identifies the problem type. */
  type: url;

  /** Short, human-readable summary of the problem type. */
  title: string;

  /** HTTP status code of this occurrence. */
  @minValue(400)
  @maxValue(599)
  status: int32;

  /** Explanation specific to this occurrence. */
  detail?: string;

  /** URI reference that identifies this occurrence. */
  instance?: string;
}

/** An error response carrying problem details as `application/problem+json`. */
@error
model Problem<Status extends int32> {
  @statusCode statusCode: Status;
  @header("content-type") contentType: "application/problem+json";
  @body problem: ProblemDetails;
}

/** The request was malformed or failed validation. */
@error
model BadRequest is Problem<400>;

/** No valid bearer token was sent. */
@error
model Unauthorized is Problem<401>;

/** The resource does not exist. */
@error
model NotFound is Problem<404>;

/** The request conflicts with the current state of the resource. */
@error
model Conflict is Problem<409>;
