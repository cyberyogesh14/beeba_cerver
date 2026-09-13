import {
  getOverview,
  getServiceBreakdown,
  getHourlyTrend,
} from "../services/analytics.service.js";

import { successResponse } from "../utils/apiResponse.js";

export const getAnalyticsOverview = async (
  req,
  res,
  next
) => {
  try {
    const overview = await getOverview();

    return successResponse(res, {
      message: "Dashboard overview retrieved",
      data: overview,
    });
  } catch (error) {
    next(error);
  }
};

export const getAnalyticsServices = async (
  req,
  res,
  next
) => {
  try {
    const services = await getServiceBreakdown();

    return successResponse(res, {
      message: "Service analytics retrieved",
      data: {
        count: services.length,
        services,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getAnalyticsHourly = async (
  req,
  res,
  next
) => {
  try {
    const hourly = await getHourlyTrend();

    return successResponse(res, {
      message: "Hourly trend retrieved",
      data: {
        hours: hourly,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getFullDashboard = async (
  req,
  res,
  next
) => {
  try {
    const [overview, serviceBreakdown, hourly] =
      await Promise.all([
        getOverview(),
        getServiceBreakdown(),
        getHourlyTrend(),
      ]);

    return successResponse(res, {
      message: "Dashboard analytics retrieved",
      data: {
        overview,
        services: serviceBreakdown,
        hours: hourly,
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    next(error);
  }
};
