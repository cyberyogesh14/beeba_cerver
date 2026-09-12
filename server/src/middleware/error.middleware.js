export const notFoundHandler = (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
};

const isOperational = (error) =>
  Number.isInteger(error.statusCode) &&
  error.statusCode >= 400 &&
  error.statusCode < 500;

export const errorHandler = (error, req, res, next) => {
  // Log full details server-side for diagnostics.
  console.error(error);

  // MongoDB duplicate key
  if (error.code === 11000) {
    const field = Object.keys(error.keyPattern)[0];

    return res.status(409).json({
      success: false,
      message: `${field} already exists`,
    });
  }

  // Mongoose CastError (invalid ObjectId)
  if (
    error.name === "CastError" &&
    error.kind === "ObjectId"
  ) {
    return res.status(400).json({
      success: false,
      message: "Invalid ID format",
    });
  }

  // Mongoose validation errors
  if (error.name === "ValidationError") {
    const messages = Object.values(error.errors).map(
      (e) => e.message
    );
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: messages,
    });
  }

  // Validation errors from Express/body-parser carry a type.
  if (error.type === "entity.parse.failed") {
    return res.status(400).json({
      success: false,
      message: "Invalid JSON payload",
    });
  }

  // Reject oversized payloads with a friendly message.
  if (error.type === "entity.too.large") {
    return res.status(413).json({
      success: false,
      message: "Request payload is too large",
    });
  }

  const statusCode = error.statusCode || 500;

  // Only surface the real message for operational (4xx) errors.
  // True 5xx errors never expose internals to the client.
  const message = isOperational(error)
    ? error.message
    : "Internal server error";

  return res.status(statusCode).json({
    success: false,
    message,
  });
};