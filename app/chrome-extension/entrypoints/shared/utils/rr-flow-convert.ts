/**
 * @fileoverview V2/V3 Flow 双向转换工具
 * @description 桥接 Builder V2 Flow 类型与 V3 RPC FlowV3 类型
 *
 * 设计说明:
 * - Builder store 目前仍使用 V2 类型 (type, version, steps)
 * - RPC 层使用 V3 类型 (kind, schemaVersion, entryNodeId)
 * - 本模块提供 UI 层的类型转换，封装底层转换器
 */

import type { Flow as FlowV2 } from '@/entrypoints/background/record-replay/types';
import type { FlowV3 } from '@/entrypoints/background/record-replay-v3/domain/flow';
import {
  convertFlowV2ToV3,
  convertFlowV3ToV2,
} from '@/entrypoints/background/record-replay-v3/storage/import/v2-to-v3';

// ==================== Types ====================

export interface FlowConversionResult<T> {
  flow: T;
  warnings: string[];
}

// ==================== V2 -> V3 (for RPC calls) ====================

/**
 * 将 V2 Flow 转换为 V3 格式，用于 RPC 保存
 * @param flowV2 Builder store 中的 V2 Flow
 * @returns V3 Flow 和警告信息
 * @throws 转换失败时抛出错误
 */
export function flowV2ToV3ForRpc(flowV2: FlowV2): FlowConversionResult<FlowV3> {
  const result = convertFlowV2ToV3(flowV2 as unknown as Parameters<typeof convertFlowV2ToV3>[0]);

  if (!result.success || !result.data) {
    const errorMsg =
      result.errors.length > 0 ? result.errors.join('; ') : 'Unknown conversion error';
    throw new Error(`V2→V3 conversion failed: ${errorMsg}`);
  }

  return {
    flow: result.data,
    warnings: result.warnings,
  };
}

// ==================== V3 -> V2 (for Builder display) ====================

/**
 * 将 V3 Flow 转换为 V2 格式，用于 Builder 显示和编辑
 * @param flowV3 从 RPC 获取的 V3 Flow
 * @returns V2 Flow 和警告信息
 * @throws 转换失败时抛出错误
 */
export function flowV3ToV2ForBuilder(flowV3: FlowV3): FlowConversionResult<FlowV2> {
  const result = convertFlowV3ToV2(flowV3);

  if (!result.success || !result.data) {
    const errorMsg =
      result.errors.length > 0 ? result.errors.join('; ') : 'Unknown conversion error';
    throw new Error(`V3→V2 conversion failed: ${errorMsg}`);
  }

  return {
    flow: result.data as unknown as FlowV2,
    warnings: result.warnings,
  };
}

// ==================== Type Guards ====================

/**
 * 判断是否为 V3 Flow
 * @description 用于导入时判断 JSON 格式
 */
export function isFlowV3(value: unknown): value is FlowV3 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const obj = value as Record<string, unknown>;
  return (
    obj.schemaVersion === 3 &&
    typeof obj.id === 'string' &&
    typeof obj.name === 'string' &&
    typeof obj.entryNodeId === 'string' &&
    Array.isArray(obj.nodes)
  );
}

/**
 * 判断是否为 V2 Flow
 * @description 用于导入时判断 JSON 格式
 */
export function isFlowV2(value: unknown): value is FlowV2 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    typeof obj.name === 'string' &&
    // V2 有 version 字段（数字），且没有 schemaVersion
    typeof obj.version === 'number' &&
    obj.schemaVersion === undefined &&
    // V2 可能有 steps 或 nodes
    (Array.isArray(obj.steps) || Array.isArray(obj.nodes))
  );
}

// ==================== Import Helpers ====================

/**
 * 从导入的 JSON 中提取 Flow 候选列表
 * @description 支持单个 Flow、Flow 数组、或 { flows: Flow[] } 格式
 */
export function extractFlowCandidates(parsed: unknown): unknown[] {
  // 数组格式
  if (Array.isArray(parsed)) {
    return parsed;
  }

  // 对象格式
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;

    // { flows: [...] } 格式
    if (Array.isArray(obj.flows)) {
      return obj.flows;
    }

    // 单个 Flow 对象
    if (obj.id && (Array.isArray(obj.steps) || Array.isArray(obj.nodes))) {
      return [obj];
    }
  }

  return [];
}
