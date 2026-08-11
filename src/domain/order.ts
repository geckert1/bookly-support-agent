import { z } from "zod";

export const OrderStatusSchema = z.enum([
  "processing",
  "shipped",
  "delivered",
  "cancelled",
]);

export const OrderItemSchema = z.object({
  sku: z.string().min(1),
  title: z.string().min(1),
  quantity: z.number().int().positive(),
  finalSale: z.boolean().default(false),
});

export const OrderSchema = z.object({
  id: z.string().regex(/^BK-\d{5}$/),
  customerName: z.string().min(1),
  customerEmail: z.string().email(),
  status: OrderStatusSchema,
  placedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deliveredAt: z.string().datetime().optional(),
  estimatedDelivery: z.string().date().optional(),
  carrier: z.string().min(1).optional(),
  trackingNumber: z.string().min(1).optional(),
  items: z.array(OrderItemSchema).min(1),
});

export type OrderStatus = z.infer<typeof OrderStatusSchema>;
export type OrderItem = z.infer<typeof OrderItemSchema>;
export type Order = z.infer<typeof OrderSchema>;
