class MockTensor {
  data: number[];
  dims: number[];

  constructor(data: number[] = [], dims: number[] = [data.length]) {
    this.data = data;
    this.dims = dims;
  }
}

const defaultTokenized = {
  input_ids: new MockTensor([101, 102], [1, 2]),
  attention_mask: new MockTensor([1, 1], [1, 2]),
  token_type_ids: new MockTensor([0, 0], [1, 2]),
};

class MockTokenizer {
  async dispose(): Promise<void> {
    return;
  }

  async call(): Promise<typeof defaultTokenized> {
    return defaultTokenized;
  }

  async batch_decode(): Promise<string[]> {
    return [];
  }
}

export const AutoTokenizer = {
  async from_pretrained(): Promise<MockTokenizer> {
    return new MockTokenizer();
  },
};

export const env = {
  allowRemoteModels: false,
  allowLocalModels: true,
  backends: {
    onnx: {
      wasm: {
        numThreads: 1,
      },
    },
  },
};

export { MockTensor as Tensor };
export type PreTrainedTokenizer = MockTokenizer;
