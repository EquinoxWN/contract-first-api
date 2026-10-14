// First draft of the Orders API, written with TypeSpec defaults before the style guide existed.
// Kept as the baseline: `contract build --root test/fixtures/draft` must fail on all three
// style-guide areas (naming, pagination, error format). See docs/results/m1.md.
import "@typespec/http";

using Http;

@service(#{ title: "Orders API" })
namespace ContractFirst.Orders;

model Customer {
  @visibility(Lifecycle.Read) id: string;
  email: string;
  display_name: string;
  @visibility(Lifecycle.Read) created_at: utcDateTime;
}

enum OrderStatus { pending, paid, shipped, cancelled }

model OrderLine {
  sku: string;
  quantity: int32;
  unit_price_cents: int64;
}

model Order {
  @visibility(Lifecycle.Read) id: string;
  customer_id: string;
  @visibility(Lifecycle.Read) status: OrderStatus;
  lines: OrderLine[];
  @visibility(Lifecycle.Read) created_at: utcDateTime;
}

@error
model Error {
  code: int32;
  message: string;
}

@route("/customers")
interface Customers {
  @get list(@query offset?: int32, @query limit?: int32): Customer[] | Error;
  @get read(@path customerId: string): Customer | Error;
  @post create(@body customer: Customer): { @statusCode statusCode: 201; @body customer: Customer } | Error;
  @get @route("{customerId}/orders") listOrders(@path customerId: string, @query page?: int32): Order[] | Error;
}

@route("/orders")
interface Orders {
  @get list(@query status?: OrderStatus, @query offset?: int32, @query limit?: int32): Order[] | Error;
  @get read(@path orderId: string): Order | Error;
  @post create(@body order: Order): { @statusCode statusCode: 201; @body order: Order } | Error;
  @post @route("{orderId}/cancel") cancel(@path orderId: string): Order | Error;
}
