/**
 * Central socket emitter.
 *
 * Controllers call these functions after a successful
 * mutation so every connected screen updates in real
 * time. Keeping the emitter separate from business
 * logic means queue.service stays socket-agnostic.
 */
let io = null;

export const setIO = (instance) => {
  io = instance;
};

export const emitToAll = (event, payload) => {
  if (!io) return;
  io.emit(event, payload);
};

export const emitToAdmins = (event, payload) => {
  if (!io) return;
  io.to("admin").emit(event, payload);
};

export const emitToStaff = (event, payload) => {
  if (!io) return;
  io.to("staff").emit(event, payload);
};

export const emitToDisplay = (event, payload) => {
  if (!io) return;
  io.to("display").emit(event, payload);
};

export const emitToQueue = (serviceId, event, payload) => {
  if (!io) return;
  io.to(`queue:${serviceId}`).emit(event, payload);
};

export const emitToCustomer = (customerId, event, payload) => {
  if (!io) return;
  io.to(`customer:${customerId}`).emit(event, payload);
};
