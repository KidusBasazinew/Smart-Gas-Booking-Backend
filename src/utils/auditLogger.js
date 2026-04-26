const AuditLog = require("../models/AuditLog");

const getClientIp = (req) => {
  const xff = req && req.headers ? req.headers["x-forwarded-for"] : null;
  if (typeof xff === "string" && xff.trim()) return xff.split(",")[0].trim();
  return String((req && (req.ip || req.connection?.remoteAddress)) || "");
};

const getUserAgent = (req) => {
  if (!req || typeof req.get !== "function") return "";
  return String(req.get("user-agent") || "");
};

const logAudit = async ({
  req,
  user,
  action,
  entityType = "",
  entityId = null,
  metadata = {},
  status = "success",
  role,
}) => {
  const u = user || (req && req.user) || null;
  const safeRole = role !== undefined ? String(role || "") : u ? u.role : "";

  const doc = {
    user: u && u._id ? u._id : null,
    role: safeRole ? String(safeRole) : "",
    action: String(action || "").trim(),
    entityType: String(entityType || "").trim(),
    entityId: entityId || null,
    metadata: metadata !== undefined ? metadata : {},
    ipAddress: req ? getClientIp(req) : "",
    userAgent: req ? getUserAgent(req) : "",
    status: status === "failed" ? "failed" : "success",
  };

  if (!doc.action) return null;

  try {
    const created = await AuditLog.create(doc);
    return created;
  } catch (err) {
    // Never block business logic because of audit logging.
    return null;
  }
};

const auditMiddleware =
  ({ action, entityType, entityIdFrom = null, metadataFrom = null } = {}) =>
  async (req, res, next) => {
    const startedAt = Date.now();
    res.on("finish", async () => {
      const ok = res.statusCode >= 200 && res.statusCode < 400;
      const entityId =
        typeof entityIdFrom === "function" ? entityIdFrom(req, res) : null;
      const metadata =
        typeof metadataFrom === "function"
          ? metadataFrom(req, res, { durationMs: Date.now() - startedAt })
          : { durationMs: Date.now() - startedAt };

      await logAudit({
        req,
        user: req.user,
        action,
        entityType,
        entityId,
        metadata,
        status: ok ? "success" : "failed",
      });
    });

    return next();
  };

module.exports = {
  logAudit,
  auditMiddleware,
};

