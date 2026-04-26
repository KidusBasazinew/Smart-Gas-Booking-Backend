const Vehicle = require("../models/Vehicle");

const addVehicle = async (req, res, next) => {
  try {
    const driverId = req.user._id;
    const { plateNumber, type, model, color } = req.body;

    const count = await Vehicle.countDocuments({ driver: driverId });
    if (count >= 3) {
      return res.status(400).json({
        success: false,
        message: "Maximum of 3 vehicles allowed",
      });
    }

    const normalizedPlate = String(plateNumber || "")
      .trim()
      .toUpperCase();
    const existing = await Vehicle.findOne({ plateNumber: normalizedPlate });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: "Vehicle with this plate number already exists",
      });
    }

    const vehicle = await Vehicle.create({
      driver: driverId,
      plateNumber: normalizedPlate,
      type,
      model: model ? String(model).trim() : "",
      color: color ? String(color).trim() : "",
      isActive: true,
    });

    await Vehicle.updateMany(
      { driver: driverId, _id: { $ne: vehicle._id } },
      { $set: { isActive: false } },
    );

    return res.status(201).json({
      success: true,
      message: "Vehicle added",
      data: { vehicle },
    });
  } catch (err) {
    return next(err);
  }
};

const getMyVehicles = async (req, res, next) => {
  try {
    const vehicles = await Vehicle.find({ driver: req.user._id }).sort({
      createdAt: -1,
    });

    return res.status(200).json({
      success: true,
      data: { vehicles },
    });
  } catch (err) {
    return next(err);
  }
};

const updateVehicle = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { plateNumber, type, model, color } = req.body;

    const vehicle = await Vehicle.findOne({ _id: id, driver: req.user._id });
    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: "Vehicle not found",
      });
    }

    if (plateNumber !== undefined) {
      const normalizedPlate = String(plateNumber || "")
        .trim()
        .toUpperCase();
      if (!normalizedPlate) {
        return res.status(422).json({
          success: false,
          message: "plateNumber cannot be empty",
        });
      }

      if (normalizedPlate !== vehicle.plateNumber) {
        const exists = await Vehicle.findOne({ plateNumber: normalizedPlate });
        if (exists) {
          return res.status(409).json({
            success: false,
            message: "Vehicle with this plate number already exists",
          });
        }
      }

      vehicle.plateNumber = normalizedPlate;
    }

    if (type !== undefined) vehicle.type = type;
    if (model !== undefined) vehicle.model = String(model || "").trim();
    if (color !== undefined) vehicle.color = String(color || "").trim();

    await vehicle.save();

    return res.status(200).json({
      success: true,
      message: "Vehicle updated",
      data: { vehicle },
    });
  } catch (err) {
    return next(err);
  }
};

const deleteVehicle = async (req, res, next) => {
  try {
    const { id } = req.params;

    const vehicle = await Vehicle.findOneAndDelete({
      _id: id,
      driver: req.user._id,
    });
    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: "Vehicle not found",
      });
    }

    const remaining = await Vehicle.find({ driver: req.user._id }).sort({
      updatedAt: -1,
    });
    const hasActive = remaining.some((v) => v.isActive);

    if (!hasActive && remaining.length > 0) {
      remaining[0].isActive = true;
      await remaining[0].save();
    }

    return res.status(200).json({
      success: true,
      message: "Vehicle deleted",
    });
  } catch (err) {
    return next(err);
  }
};

const setActiveVehicle = async (req, res, next) => {
  try {
    const { id } = req.params;

    const vehicle = await Vehicle.findOne({ _id: id, driver: req.user._id });
    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: "Vehicle not found",
      });
    }

    await Vehicle.updateMany(
      { driver: req.user._id },
      { $set: { isActive: false } },
    );
    vehicle.isActive = true;
    await vehicle.save();

    return res.status(200).json({
      success: true,
      message: "Active vehicle set",
      data: { vehicle },
    });
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  addVehicle,
  getMyVehicles,
  updateVehicle,
  deleteVehicle,
  setActiveVehicle,
};
