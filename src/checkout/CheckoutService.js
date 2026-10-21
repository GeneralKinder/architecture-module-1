export class CheckoutService {
  constructor({ orderService, inventoryService, paymentService, notificationService }) {
    this.orderService = orderService;
    this.inventoryService = inventoryService;
    this.paymentService = paymentService;
    this.notificationService = notificationService;
  }

  async checkout(command) {
    const startedAt = performance.now();
    let order = this.orderService.createDraft(command);
    let inventoryReserved = false;

    try {
      this.inventoryService.reserve(order);
      inventoryReserved = true;
      order = this.orderService.markInventoryReserved(order.id);

      const payment = await this.paymentService.chargeOrder(
        { orderId: order.id, amountCents: order.totalCents, currency: order.currency },
        command.paymentToken
      );
      order = this.orderService.markPaid(order.id, payment.id);
      order = this.orderService.complete(order.id);

      // Deliberate critical-path dependency: checkout waits for email delivery.
      const notification = await this.notificationService.sendOrderConfirmation(order);

      return {
        order,
        payment,
        notification,
        durationMs: Math.round(performance.now() - startedAt)
      };
    } catch (error) {
      if (inventoryReserved) this.inventoryService.release(order);
      this.orderService.fail(order.id, error.code ?? "UNEXPECTED_ERROR");
      throw error;
    }
  }
}
