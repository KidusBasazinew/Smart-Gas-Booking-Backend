const auditAdmin = (action = "admin_action") => {
  return (req, res, next) => {
    const startedAt = Date.now();

    res.on("finish", () => {
      try {
        const user = req.user;
        const durationMs = Date.now() - startedAt;

        const entry = {
          action,
          method: req.method,
          path: req.originalUrl,
          statusCode: res.statusCode,
          durationMs,
          userId: user ? String(user._id) : null,
          role: user ? user.role : null,
          ip: req.ip,
          at: new Date().toISOString(),
        };

        // Optional audit trail: replace with DB persistence if needed later.
        // eslint-disable-next-line no-console
        console.log("[AUDIT]", JSON.stringify(entry));
      } catch (err) {
        // eslint-disable-next-line no-console
        console.log(
          "[AUDIT_ERROR]",
          String(err && err.message ? err.message : err),
        );
      }
    });

    return next();
  };
};

module.exports = auditAdmin;
