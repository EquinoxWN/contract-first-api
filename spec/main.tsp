import "@typespec/http";
import "@typespec/openapi";
import "./lib/style.tsp";

using Http;
using OpenAPI;
using ContractFirst.Style;

/**
 * Customers and orders of a small online shop. Designed in TypeSpec first; the OpenAPI 3.1
 * document is generated from this file and checked against the house style guide.
 */
@service(#{ title: "Orders API" })
@info(#{
  version: "1.0.0",
  contact: #{
    name: "contract-first-api",
    url: "https://github.com/EquinoxWN/contract-first-api",
  },
  license: #{ name: "MIT", identifier: "MIT" },
})
@server("https://api.example.com/v1", "Example deployment (placeholder host)")
@useAuth(BearerAuth)
@tagMetadata("Customers", #{ description: "People who place orders." })
@tagMetadata(
  "Orders",
  #{ description: "Orders, their lines and their status." }
)
namespace ContractFirst.Orders;

/** Server-assigned identifier: a type prefix, an underscore and 16 to 32 letters or digits. */
@pattern("^[a-z]{2,8}_[A-Za-z0-9]{16,32}$")
scalar ResourceId extends string;

/** A customer who can place orders. */
model Customer {
  /** Server-assigned identifier, for example `cus_8f14e45fceea167a`. */
  @visibility(Lifecycle.Read)
  id: ResourceId;

  /** Contact email address. */
  @format("email")
  @maxLength(254)
  email: string;

  /** Name printed on invoices. */
  @minLength(1)
  @maxLength(100)
  displayName: string;

  /** When the customer was created. */
  @visibility(Lifecycle.Read)
  createdAt: utcDateTime;
}

/** An amount of money in the minor unit of its currency (for example cents). */
model Money {
  /** Amount in minor units. */
  @minValue(0)
  amountMinor: int64;

  /** ISO 4217 currency code. */
  @pattern("^[A-Z]{3}$")
  currency: string;
}

/** Where an order is in its lifecycle. */
enum OrderStatus {
  pending,
  paid,
  shipped,
  cancelled,
}

/** One product line of an order. */
model OrderLine {
  /** Stock-keeping unit of the product. */
  @pattern("^[A-Z0-9-]{3,32}$")
  sku: string;

  /** Number of units. */
  @minValue(1)
  @maxValue(1000)
  quantity: int32;

  /** Price of one unit. */
  unitPrice: Money;
}

/** An order placed by a customer. */
model Order {
  /** Server-assigned identifier, for example `ord_c9f0f895fb98ab91`. */
  @visibility(Lifecycle.Read)
  id: ResourceId;

  /** The customer who placed the order. */
  customerId: ResourceId;

  /** Current status. */
  @visibility(Lifecycle.Read)
  status: OrderStatus;

  /** Ordered products. */
  @minItems(1)
  @maxItems(100)
  lines: OrderLine[];

  /** Sum of all lines, computed by the server. */
  @visibility(Lifecycle.Read)
  total: Money;

  /** When the order was placed. */
  @visibility(Lifecycle.Read)
  createdAt: utcDateTime;
}

/** A resource was created. */
model Created<Resource> {
  @statusCode statusCode: 201;

  /** URL of the new resource. */
  @header location: string;

  @body resource: Resource;
}

@tag("Customers")
@route("/customers")
interface Customers {
  /** List customers, newest first. */
  @list
  @get
  @operationId("listCustomers")
  list(...PageParameters): Page<Customer> | BadRequest | Unauthorized;

  /** Create a customer. */
  @post
  @operationId("createCustomer")
  create(@body customer: Customer):
    | Created<Customer>
    | BadRequest
    | Unauthorized
    | Conflict;

  /** Get one customer. */
  @get
  @route("{customerId}")
  @operationId("getCustomer")
  get(@path customerId: ResourceId): Customer | Unauthorized | NotFound;

  /** List the orders of one customer, newest first. */
  @list
  @get
  @route("{customerId}/orders")
  @operationId("listCustomerOrders")
  listOrders(@path customerId: ResourceId, ...PageParameters):
    | Page<Order>
    | BadRequest
    | Unauthorized
    | NotFound;
}

@tag("Orders")
@route("/orders")
interface Orders {
  /** List orders, newest first, optionally filtered by status. */
  @list
  @get
  @operationId("listOrders")
  list(
    /** Only return orders in this status. */
    @query status?: OrderStatus,

    ...PageParameters,
  ): Page<Order> | BadRequest | Unauthorized;

  /** Place an order. Retrying with the same idempotency key returns the first result. */
  @post
  @operationId("createOrder")
  create(
    /** Client-chosen key that makes retries safe. */
    @header("Idempotency-Key") @maxLength(64) idempotencyKey: string,

    @body order: Order,
  ): Created<Order> | BadRequest | Unauthorized | Conflict;

  /** Get one order. */
  @get
  @route("{orderId}")
  @operationId("getOrder")
  get(@path orderId: ResourceId): Order | Unauthorized | NotFound;

  /** Cancel an order that has not shipped yet. */
  @post
  @route("{orderId}/cancellation")
  @operationId("cancelOrder")
  cancel(@path orderId: ResourceId): Order | Unauthorized | NotFound | Conflict;
}
