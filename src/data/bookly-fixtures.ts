// Responsibility: Provide validated, deterministic Bookly orders for the local tool adapter.
// Boundary: Fixture data models external records but is not a production persistence layer.

import { OrderSchema, type Order } from "../domain/order.js";

const fixtureOrders = [
  {
    id: "BK-10421",
    customerName: "Maya Chen",
    customerEmail: "maya.chen@example.com",
    status: "shipped",
    placedAt: "2026-07-30T14:12:00.000Z",
    updatedAt: "2026-08-04T18:40:00.000Z",
    estimatedDelivery: "2026-08-10",
    carrier: "UPS",
    trackingNumber: "1ZBOOKLY10421",
    items: [
      {
        sku: "BK-FIC-1842",
        title: "The Cartographer's Lantern",
        quantity: 1,
        finalSale: false,
      },
    ],
  },
  {
    id: "BK-10422",
    customerName: "Maya Chen",
    customerEmail: "maya.chen@example.com",
    status: "delivered",
    placedAt: "2026-07-19T16:05:00.000Z",
    updatedAt: "2026-07-28T20:16:00.000Z",
    deliveredAt: "2026-07-28T20:16:00.000Z",
    carrier: "UPS",
    trackingNumber: "1ZBOOKLY10422",
    items: [
      {
        sku: "BK-NON-2301",
        title: "Small Systems, Clear Thinking",
        quantity: 1,
        finalSale: false,
      },
    ],
  },
  {
    id: "BK-10423",
    customerName: "Maya Chen",
    customerEmail: "maya.chen@example.com",
    status: "delivered",
    placedAt: "2026-05-31T13:48:00.000Z",
    updatedAt: "2026-06-10T17:22:00.000Z",
    deliveredAt: "2026-06-10T17:22:00.000Z",
    carrier: "USPS",
    trackingNumber: "9400BOOKLY10423",
    items: [
      {
        sku: "BK-COO-7710",
        title: "Weeknight Baking",
        quantity: 1,
        finalSale: false,
      },
    ],
  },
  {
    id: "BK-10424",
    customerName: "Jon Bell",
    customerEmail: "jon.bell@example.com",
    status: "processing",
    placedAt: "2026-08-07T09:31:00.000Z",
    updatedAt: "2026-08-07T09:31:00.000Z",
    estimatedDelivery: "2026-08-14",
    items: [
      {
        sku: "BK-HIS-6113",
        title: "A Brief Atlas of Printing",
        quantity: 1,
        finalSale: false,
      },
    ],
  },
] satisfies unknown[];

export const BOOKLY_ORDERS: readonly Order[] = Object.freeze(
  OrderSchema.array().parse(fixtureOrders),
);

export function findBooklyOrder(orderId: string): Order | undefined {
  const normalizedId = orderId.trim().toUpperCase();
  return BOOKLY_ORDERS.find((order) => order.id === normalizedId);
}
