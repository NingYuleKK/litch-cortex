/**
 * V0.9 Job Queue Tests
 *
 * Tests job submission, dedup (S1), progress tracking, cancel, retry,
 * and formatJobProgress logic.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all DB functions used by job-queue.ts
vi.mock("./db", () => ({
  createJob: vi.fn(),
  getJobById: vi.fn(),
  updateJob: vi.fn(),
  claimNextPendingJob: vi.fn(),
  getActiveJobByTypeAndProject: vi.fn(),
  resetRunningJobs: vi.fn(),
  getChunksWithoutEmbeddingV2Limited: vi.fn(),
  getEmbeddingCountByProjectV2: vi.fn(),
  insertChunkEmbeddingsBatch: vi.fn(),
  getChunksWithoutTopicsByProject: vi.fn(),
  getChunksByProjectCountV2: vi.fn(),
  deleteChunkTopicsByChunkId: vi.fn(),
  findOrCreateTopic: vi.fn(),
  linkChunkToTopic: vi.fn(),
}));

vi.mock("./embedding-service", () => ({
  generateEmbeddingsBatch: vi.fn(),
}));

import {
  submitJob,
  getJobProgress,
  cancelJob,
  retryJob,
} from "./job-queue";

import {
  createJob,
  getJobById,
  updateJob,
  getActiveJobByTypeAndProject,
  resetRunningJobs,
  getEmbeddingCountByProjectV2,
  getChunksByProjectCountV2,
} from "./db";

const mockCreateJob = vi.mocked(createJob);
const mockGetJobById = vi.mocked(getJobById);
const mockUpdateJob = vi.mocked(updateJob);
const mockGetActiveJob = vi.mocked(getActiveJobByTypeAndProject);
const mockGetEmbCount = vi.mocked(getEmbeddingCountByProjectV2);
const mockGetChunkCount = vi.mocked(getChunksByProjectCountV2);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("submitJob", () => {
  it("should create a new embedding_generation job", async () => {
    mockGetActiveJob.mockResolvedValue(undefined);
    mockGetEmbCount.mockResolvedValue({ total: 100, withEmbedding: 30 });
    mockCreateJob.mockResolvedValue(42);

    const result = await submitJob(1, "embedding_generation");
    expect(result).toEqual({ jobId: 42, deduplicated: false });
    expect(mockCreateJob).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 1,
      type: "embedding_generation",
      totalItems: 70, // 100 - 30
    }));
  });

  it("should create a new topic_extraction job", async () => {
    mockGetActiveJob.mockResolvedValue(undefined);
    mockGetChunkCount.mockResolvedValue(200);
    mockCreateJob.mockResolvedValue(55);

    const result = await submitJob(1, "topic_extraction");
    expect(result).toEqual({ jobId: 55, deduplicated: false });
    expect(mockCreateJob).toHaveBeenCalledWith(expect.objectContaining({
      type: "topic_extraction",
      totalItems: 200,
    }));
  });

  it("should dedup if active job exists (S1)", async () => {
    mockGetActiveJob.mockResolvedValue({
      id: 99,
      projectId: 1,
      type: "embedding_generation",
      status: "running",
      totalItems: 50,
      processedItems: 10,
      attempts: 1,
      maxAttempts: 3,
      lastError: null,
      params: null,
      result: null,
      createdAt: new Date(),
      startedAt: new Date(),
      completedAt: null,
      updatedAt: new Date(),
    });

    const result = await submitJob(1, "embedding_generation");
    expect(result).toEqual({ jobId: 99, deduplicated: true });
    expect(mockCreateJob).not.toHaveBeenCalled();
  });
});

describe("getJobProgress", () => {
  it("should return formatted progress for existing job", async () => {
    mockGetJobById.mockResolvedValue({
      id: 10,
      projectId: 1,
      type: "embedding_generation",
      status: "running",
      totalItems: 100,
      processedItems: 40,
      attempts: 1,
      maxAttempts: 3,
      lastError: null,
      params: null,
      result: null,
      createdAt: new Date(),
      startedAt: new Date(),
      completedAt: null,
      updatedAt: new Date(),
    });

    const progress = await getJobProgress(10);
    expect(progress).toBeTruthy();
    expect(progress!.percentage).toBe(40);
    expect(progress!.status).toBe("running");
  });

  it("should return null for non-existent job", async () => {
    mockGetJobById.mockResolvedValue(undefined);
    const progress = await getJobProgress(999);
    expect(progress).toBeNull();
  });
});

describe("cancelJob", () => {
  it("should cancel a pending job", async () => {
    mockGetJobById.mockResolvedValue({
      id: 5,
      projectId: 1,
      type: "embedding_generation",
      status: "pending",
      totalItems: 50,
      processedItems: 0,
      attempts: 0,
      maxAttempts: 3,
      lastError: null,
      params: null,
      result: null,
      createdAt: new Date(),
      startedAt: null,
      completedAt: null,
      updatedAt: new Date(),
    });

    const result = await cancelJob(5);
    expect(result).toBe(true);
    expect(mockUpdateJob).toHaveBeenCalledWith(5, { status: "cancelled" });
  });

  it("should not cancel a completed job", async () => {
    mockGetJobById.mockResolvedValue({
      id: 5,
      projectId: 1,
      type: "embedding_generation",
      status: "completed",
      totalItems: 50,
      processedItems: 50,
      attempts: 1,
      maxAttempts: 3,
      lastError: null,
      params: null,
      result: null,
      createdAt: new Date(),
      startedAt: new Date(),
      completedAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await cancelJob(5);
    expect(result).toBe(false);
    expect(mockUpdateJob).not.toHaveBeenCalled();
  });
});

describe("retryJob", () => {
  it("should retry a failed job by submitting a new one", async () => {
    mockGetJobById.mockResolvedValue({
      id: 7,
      projectId: 2,
      type: "topic_extraction",
      status: "failed",
      totalItems: 100,
      processedItems: 30,
      attempts: 3,
      maxAttempts: 3,
      lastError: "LLM error",
      params: null,
      result: null,
      createdAt: new Date(),
      startedAt: new Date(),
      completedAt: new Date(),
      updatedAt: new Date(),
    });

    // For submitJob inside retryJob:
    mockGetActiveJob.mockResolvedValue(undefined);
    mockGetChunkCount.mockResolvedValue(100);
    mockCreateJob.mockResolvedValue(8);

    const newJobId = await retryJob(7);
    expect(newJobId).toBe(8);
  });

  it("should return null if job is not in failed state", async () => {
    mockGetJobById.mockResolvedValue({
      id: 7,
      projectId: 2,
      type: "topic_extraction",
      status: "running",
      totalItems: 100,
      processedItems: 30,
      attempts: 1,
      maxAttempts: 3,
      lastError: null,
      params: null,
      result: null,
      createdAt: new Date(),
      startedAt: new Date(),
      completedAt: null,
      updatedAt: new Date(),
    });

    const result = await retryJob(7);
    expect(result).toBeNull();
  });
});
