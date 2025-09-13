// FAR Compliance Audit System - Complete App.js with Document Linking Modal
// Orchestrator (ES Modules)

import { auditAll } from "./modules/services/auditService.js";
import { readExcelFile, mapExcelRows, readExcelAsAOA, mapRowsFromAOA, detectHeaderRow } from "./modules/services/excelService.js";
import { renderGLTable, filterData } from "./modules/ui/tableView.js";
import { updateDashboard as updateDashboardUI } from "./modules/ui/dashboard.js";
import { generateReport as genReport, exportToPDF as exportPDF } from "./modules/reports/reportService.js";
import { renderLogDashboard, initializeLogDashboard, destroyLogDashboard } from "./modules/ui/logDashboard.js";

import {
  saveGLEntries,
  serverLLMReview, serverLLMMapColumns,
  ingestDocuments, listDocItems, getRequirements, fetchGLEntries,
  linkDocItem, unlinkDocItem
} from "./modules/services/apiService.js";

import { farRules as builtinFarRules } from "./modules/data/farRules.js";

class FARComplianceApp {
  constructor() {
    this.glData = [];
    this.auditResults = [];
    this.charts = {
      complianceChart: null,
      violationsChart: null,
      amountChart: null
    };
    this.uploadedFile = null;
    this.farRules = [];
    this.config = {};
    this.apiBaseUrl = null;
    this.azure = {
      endpoint: '',
      apiKey: '',
      deployment: '',
      apiVersion: '2024-06-01'
    };
    this.mappingState = {
      aoa: [],
      headers: [],
      headerRowIndex: 0
    };
    this.docs = {
      files: [],
      items: [],
      links: [],
      summaryEl: null,
      statusEl: null
    };
