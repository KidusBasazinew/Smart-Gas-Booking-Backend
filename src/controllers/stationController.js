const Station = require("../models/Station");

const toNumberOrNull = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const haversineKm = (lat1, lon1, lat2, lon2) => {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const createStation = async (req, res, next) => {
  try {
    const {
      name,
      code,
      location,
      city,
      latitude,
      longitude,
      fuelTypes,
      fuelStock,
      status,
    } = req.body;

    const station = await Station.create({
      name: String(name).trim(),
      code: String(code).trim().toUpperCase(),
      location: String(location).trim(),
      city: String(city).trim(),
      latitude: toNumberOrNull(latitude),
      longitude: toNumberOrNull(longitude),
      fuelTypes: Array.isArray(fuelTypes) ? fuelTypes : [],
      fuelStock: {
        petrol:
          fuelStock && fuelStock.petrol !== undefined
            ? Number(fuelStock.petrol)
            : 0,
        diesel:
          fuelStock && fuelStock.diesel !== undefined
            ? Number(fuelStock.diesel)
            : 0,
      },
      status: status || "open",
    });

    return res.status(201).json({
      success: true,
      message: "Station created",
      data: { station },
    });
  } catch (err) {
    return next(err);
  }
};

const getStations = async (req, res, next) => {
  try {
    const { city, status } = req.query;

    const filter = { isDeleted: false };

    if (city) filter.city = String(city).trim();
    if (status) filter.status = String(status).trim();

    const stations = await Station.find(filter).sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      data: { stations },
    });
  } catch (err) {
    return next(err);
  }
};

const getNearbyStations = async (req, res, next) => {
  try {
    const city = String(req.query.city || "").trim();
    if (!city) {
      return res.status(400).json({
        success: false,
        message: "city query is required",
      });
    }

    const latitude = toNumberOrNull(req.query.latitude);
    const longitude = toNumberOrNull(req.query.longitude);

    const stations = await Station.find({
      city,
      isDeleted: false,
      status: { $ne: "offline" },
    });

    if (latitude !== null && longitude !== null) {
      stations.sort((a, b) => {
        if (a.latitude == null || a.longitude == null) return 1;
        if (b.latitude == null || b.longitude == null) return -1;

        const da = haversineKm(latitude, longitude, a.latitude, a.longitude);
        const db = haversineKm(latitude, longitude, b.latitude, b.longitude);
        return da - db;
      });
    } else {
      stations.sort((a, b) => (a.queueCount || 0) - (b.queueCount || 0));
    }

    return res.status(200).json({
      success: true,
      data: { stations },
    });
  } catch (err) {
    return next(err);
  }
};

const getStationById = async (req, res, next) => {
  try {
    const station = await Station.findOne({
      _id: req.params.id,
      isDeleted: false,
    });
    if (!station) {
      return res.status(404).json({
        success: false,
        message: "Station not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: { station },
    });
  } catch (err) {
    return next(err);
  }
};

const updateStation = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updates = { ...req.body };

    if (updates.code !== undefined)
      updates.code = String(updates.code || "")
        .trim()
        .toUpperCase();
    if (updates.name !== undefined)
      updates.name = String(updates.name || "").trim();
    if (updates.location !== undefined)
      updates.location = String(updates.location || "").trim();
    if (updates.city !== undefined)
      updates.city = String(updates.city || "").trim();
    if (updates.latitude !== undefined)
      updates.latitude = toNumberOrNull(updates.latitude);
    if (updates.longitude !== undefined)
      updates.longitude = toNumberOrNull(updates.longitude);

    delete updates.fuelStock;

    const station = await Station.findOneAndUpdate(
      { _id: id, isDeleted: false },
      { $set: updates },
      { new: true, runValidators: true },
    );
    if (!station) {
      return res.status(404).json({
        success: false,
        message: "Station not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Station updated",
      data: { station },
    });
  } catch (err) {
    return next(err);
  }
};

const updateFuelStock = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { petrol, diesel } = req.body;

    const updates = {};

    if (petrol !== undefined) {
      const p = Number(petrol);
      if (!Number.isFinite(p) || p < 0) {
        return res.status(422).json({
          success: false,
          message: "petrol stock must be a number >= 0",
        });
      }
      updates["fuelStock.petrol"] = p;
    }

    if (diesel !== undefined) {
      const d = Number(diesel);
      if (!Number.isFinite(d) || d < 0) {
        return res.status(422).json({
          success: false,
          message: "diesel stock must be a number >= 0",
        });
      }
      updates["fuelStock.diesel"] = d;
    }

    const station = await Station.findOneAndUpdate(
      { _id: id, isDeleted: false },
      { $set: updates },
      { new: true, runValidators: true },
    );

    if (!station) {
      return res.status(404).json({
        success: false,
        message: "Station not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Fuel stock updated",
      data: { station },
    });
  } catch (err) {
    return next(err);
  }
};

const changeStationStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const station = await Station.findOneAndUpdate(
      { _id: id, isDeleted: false },
      { $set: { status } },
      { new: true, runValidators: true },
    );

    if (!station) {
      return res.status(404).json({
        success: false,
        message: "Station not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Station status updated",
      data: { station },
    });
  } catch (err) {
    return next(err);
  }
};

const deleteStation = async (req, res, next) => {
  try {
    const { id } = req.params;

    const station = await Station.findOneAndUpdate(
      { _id: id, isDeleted: false },
      { $set: { isDeleted: true, status: "offline" } },
      { new: true },
    );

    if (!station) {
      return res.status(404).json({
        success: false,
        message: "Station not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Station deleted",
    });
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  createStation,
  getStations,
  getNearbyStations,
  getStationById,
  updateStation,
  updateFuelStock,
  changeStationStatus,
  deleteStation,
};
