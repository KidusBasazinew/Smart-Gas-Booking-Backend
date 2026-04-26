const DriverProfile = require("../models/DriverProfile");
const User = require("../models/User");

const createOrUpdateProfile = async (req, res, next) => {
  try {
    const userId = req.user._id;

    const { nationalId, licenseNumber, photo, address, city } = req.body;

    const existingProfile = await DriverProfile.findOne({ user: userId });

    if (!existingProfile) {
      if (!nationalId || !licenseNumber) {
        return res.status(422).json({
          success: false,
          message: "nationalId and licenseNumber are required",
        });
      }

      const duplicate = await DriverProfile.findOne({
        $or: [{ nationalId }, { licenseNumber }],
      });

      if (duplicate) {
        return res.status(409).json({
          success: false,
          message: "nationalId or licenseNumber already exists",
        });
      }

      const profile = await DriverProfile.create({
        user: userId,
        nationalId: String(nationalId).trim(),
        licenseNumber: String(licenseNumber).trim(),
        photo: photo ? String(photo).trim() : "",
        address: address ? String(address).trim() : "",
        city: city ? String(city).trim() : "",
        status: "pending",
      });

      return res.status(201).json({
        success: true,
        message: "Profile created",
        data: { profile },
      });
    }

    const updates = {
      licenseNumber: licenseNumber
        ? String(licenseNumber).trim()
        : existingProfile.licenseNumber,
      photo:
        photo !== undefined
          ? String(photo || "").trim()
          : existingProfile.photo,
      address:
        address !== undefined
          ? String(address || "").trim()
          : existingProfile.address,
      city:
        city !== undefined ? String(city || "").trim() : existingProfile.city,
    };

    if (existingProfile.status !== "approved") {
      updates.nationalId = nationalId
        ? String(nationalId).trim()
        : existingProfile.nationalId;
    }

    if (
      updates.nationalId &&
      updates.nationalId !== existingProfile.nationalId
    ) {
      const exists = await DriverProfile.findOne({
        nationalId: updates.nationalId,
        user: { $ne: userId },
      });
      if (exists) {
        return res.status(409).json({
          success: false,
          message: "nationalId already exists",
        });
      }
    }

    if (
      updates.licenseNumber &&
      updates.licenseNumber !== existingProfile.licenseNumber
    ) {
      const exists = await DriverProfile.findOne({
        licenseNumber: updates.licenseNumber,
        user: { $ne: userId },
      });
      if (exists) {
        return res.status(409).json({
          success: false,
          message: "licenseNumber already exists",
        });
      }
    }

    Object.assign(existingProfile, updates);
    await existingProfile.save();

    return res.status(200).json({
      success: true,
      message: "Profile updated",
      data: { profile: existingProfile },
    });
  } catch (err) {
    return next(err);
  }
};

const getMyProfile = async (req, res, next) => {
  try {
    const profile = await DriverProfile.findOne({
      user: req.user._id,
    }).populate("user", "name phone email role isApproved isBlocked");

    return res.status(200).json({
      success: true,
      data: { profile },
    });
  } catch (err) {
    return next(err);
  }
};

const getPendingDrivers = async (req, res, next) => {
  try {
    const profiles = await DriverProfile.find({ status: "pending" })
      .populate("user", "name phone email role isApproved isBlocked")
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      data: { profiles },
    });
  } catch (err) {
    return next(err);
  }
};

const approveDriver = async (req, res, next) => {
  try {
    const { userId } = req.params;

    const targetUser = await User.findById(userId);
    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (targetUser.role !== "driver") {
      return res.status(400).json({
        success: false,
        message: "Only drivers can be approved",
      });
    }

    const profile = await DriverProfile.findOne({ user: userId });
    if (!profile) {
      return res.status(404).json({
        success: false,
        message: "Driver profile not found",
      });
    }

    profile.status = "approved";
    profile.approvedBy = req.user._id;
    profile.approvedAt = new Date();
    await profile.save();

    targetUser.isApproved = true;
    targetUser.isBlocked = false;
    await targetUser.save();

    return res.status(200).json({
      success: true,
      message: "Driver approved",
      data: { profile },
    });
  } catch (err) {
    return next(err);
  }
};

const rejectDriver = async (req, res, next) => {
  try {
    const { userId } = req.params;

    const targetUser = await User.findById(userId);
    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (targetUser.role !== "driver") {
      return res.status(400).json({
        success: false,
        message: "Only drivers can be rejected",
      });
    }

    const profile = await DriverProfile.findOne({ user: userId });
    if (!profile) {
      return res.status(404).json({
        success: false,
        message: "Driver profile not found",
      });
    }

    profile.status = "rejected";
    profile.approvedBy = req.user._id;
    profile.approvedAt = new Date();
    await profile.save();

    targetUser.isApproved = false;
    await targetUser.save();

    return res.status(200).json({
      success: true,
      message: "Driver rejected",
      data: { profile },
    });
  } catch (err) {
    return next(err);
  }
};

const suspendDriver = async (req, res, next) => {
  try {
    const { userId } = req.params;

    const targetUser = await User.findById(userId);
    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (targetUser.role !== "driver") {
      return res.status(400).json({
        success: false,
        message: "Only drivers can be suspended",
      });
    }

    const profile = await DriverProfile.findOne({ user: userId });
    if (!profile) {
      return res.status(404).json({
        success: false,
        message: "Driver profile not found",
      });
    }

    profile.status = "suspended";
    profile.approvedBy = req.user._id;
    profile.approvedAt = new Date();
    await profile.save();

    targetUser.isApproved = false;
    targetUser.isBlocked = true;
    await targetUser.save();

    return res.status(200).json({
      success: true,
      message: "Driver suspended",
      data: { profile },
    });
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  createOrUpdateProfile,
  getMyProfile,
  getPendingDrivers,
  approveDriver,
  rejectDriver,
  suspendDriver,
};
