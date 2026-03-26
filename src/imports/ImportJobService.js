/**
 * ImportJobService - Orchestrates import operations with enhanced features
 * Service Layer: Orchestrates the import flow
 * 
 * Features:
 * - Chunked processing for large files
 * - Progress tracking
 * - Retry mechanism
 * - Batch inserts for performance
 */

const ImportJob = require('../models/ImportJob');
const CsvParser = require('./parsers/CsvParser');
const ProductImportValidator = require('./validators/ProductImportValidator');
const ClientImportValidator = require('./validators/ClientImportValidator');
const SupplierImportValidator = require('./validators/SupplierImportValidator');
const OpeningBalanceValidator = require('./validators/OpeningBalanceValidator');
const ProductImportProcessor = require('./processors/ProductImportProcessor');
const ClientImportProcessor = require('./processors/ClientImportProcessor');
const SupplierImportProcessor = require('./processors/SupplierImportProcessor');
const OpeningBalanceProcessor = require('./processors/OpeningBalanceProcessor');

const VALIDATORS = {
  'products': ProductImportValidator,
  'clients': ClientImportValidator,
  'suppliers': SupplierImportValidator,
  'opening_balance': OpeningBalanceValidator
};

const PROCESSORS = {
  'products': ProductImportProcessor,
  'clients': ClientImportProcessor,
  'suppliers': SupplierImportProcessor,
  'opening_balance': OpeningBalanceProcessor
};

// Default batch size for chunked processing
const DEFAULT_BATCH_SIZE = 100;

class ImportJobService {
  /**
   * Create a new import job
   */
  static async createJob({ type, fileName, fileSize, companyId, userId }) {
    const job = await ImportJob.create({
      type,
      fileName,
      totalRows: 0,
      company: companyId,
      createdBy: userId,
      status: 'pending'
    });
    return job;
  }

  /**
   * Process import from file buffer with optional chunking
   */
  static async processImport(job, fileBuffer, options = {}) {
    const { 
      companyId, 
      userId,
      batchSize = DEFAULT_BATCH_SIZE,
      onProgress = null // Progress callback
    } = options;

    try {
      await job.startProcessing();

      // Parse CSV using shared parser
      const parsed = CsvParser.parse(fileBuffer);
      const records = parsed.rows;
      
      job.totalRows = records.length;
      await job.save();

      if (records.length === 0) {
        throw new Error('CSV file is empty or contains only headers');
      }

      // Validate headers
      const headers = parsed.headers;
      const Validator = VALIDATORS[job.type];
      
      if (!Validator) {
        throw new Error(`Unknown import type: ${job.type}`);
      }

      const headerValidation = Validator.validateHeaders(headers);
      if (!headerValidation.valid) {
        throw new Error(headerValidation.message);
      }

      // Process in batches for large files
      const totalBatches = Math.ceil(records.length / batchSize);
      let totalSuccessful = 0;
      let totalFailed = 0;
      let allErrors = [];

      for (let batchNum = 0; batchNum < totalBatches; batchNum++) {
        const startIdx = batchNum * batchSize;
        const endIdx = Math.min(startIdx + batchSize, records.length);
        const batch = records.slice(startIdx, endIdx);
        
        // Validate batch
        const validatedRecords = [];
        const validationErrors = [];

        for (let i = 0; i < batch.length; i++) {
          const rowNum = startIdx + i + 2;
          
          // For async validation (like checking uniqueness)
          let validation;
          if (['products', 'clients', 'suppliers'].includes(job.type)) {
            validation = await Validator.validate(batch[i], rowNum, companyId);
          } else {
            validation = Validator.validate(batch[i], rowNum);
          }
          
          if (validation.valid) {
            validatedRecords.push(validation.data);
          } else {
            validationErrors.push(...validation.errors);
          }
        }

        // Process valid records
        const Processor = PROCESSORS[job.type];
        let result;
        
        if (job.type === 'opening_balance') {
          // Opening balance is atomic - process all or nothing
          result = await Processor.process(validatedRecords, companyId, options);
        } else {
          // Other imports process in batches
          result = await Processor.process(validatedRecords, companyId, options);
        }

        totalSuccessful += result.created;
        totalFailed += validationErrors.length + (result.errors?.length || 0);
        allErrors = [...allErrors, ...validationErrors, ...(result.errors || [])];

        // Update progress
        job.processedRows = endIdx;
        await job.save();

        // Call progress callback if provided
        if (onProgress) {
          onProgress({
            processed: endIdx,
            total: records.length,
            percentage: Math.round((endIdx / records.length) * 100),
            successful: totalSuccessful,
            failed: totalFailed
          });
        }
      }

      // Complete the job
      const finalStatus = totalFailed > 0 
        ? (totalSuccessful > 0 ? 'completed_with_errors' : 'failed')
        : 'completed';
      
      job.status = finalStatus;
      job.completedAt = new Date();
      job.successfulRows = totalSuccessful;
      job.failedRows = totalFailed;
      job.errors = allErrors;
      await job.save();

      return {
        success: finalStatus !== 'failed',
        job,
        result: {
          total: job.totalRows,
          processed: job.processedRows,
          successfulRows: totalSuccessful,
          failedRows: totalFailed,
          errors: allErrors
        }
      };

    } catch (error) {
      await job.fail(error);
      return {
        success: false,
        job,
        error: error.message
      };
    }
  }

  /**
   * Retry a failed import job
   */
  static async retryJob(jobId, companyId, fileBuffer, options = {}) {
    const job = await this.getJob(jobId, companyId);
    
    if (!job) {
      throw new Error('Job not found');
    }

    // Only retry failed or completed_with_errors jobs
    if (job.status !== 'failed' && job.status !== 'completed_with_errors') {
      throw new Error('Can only retry failed or completed_with_errors jobs');
    }

    // Reset job for retry
    job.status = 'pending';
    job.errors = [];
    job.failedRows = 0;
    job.successfulRows = 0;
    job.processedRows = 0;
    job.startedAt = null;
    job.completedAt = null;
    await job.save();

    return this.processImport(job, fileBuffer, options);
  }

  /**
   * Get import job by ID
   */
  static async getJob(jobId, companyId) {
    return ImportJob.findOne({ _id: jobId, company: companyId });
  }

  /**
   * Get job history for company
   */
  static async getJobHistory(companyId, options = {}) {
    const { type, status, limit = 20, skip = 0 } = options;
    
    const query = { company: companyId };
    if (type) query.type = type;
    if (status) query.status = status;

    return ImportJob.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();
  }
}

module.exports = ImportJobService;