/// <reference types="vite/client" />

// WebGPU type declarations
interface Navigator {
    gpu: GPU;
}

interface GPU {
    requestAdapter(options?: GPURequestAdapterOptions): Promise<GPUAdapter | null>;
    getPreferredCanvasFormat(): GPUTextureFormat;
}

interface GPURequestAdapterOptions {
    powerPreference?: 'low-power' | 'high-performance';
}

interface GPUAdapter {
    requestDevice(descriptor?: GPUDeviceDescriptor): Promise<GPUDevice>;
    requestAdapterInfo?(): Promise<Record<string, string>>;
}

interface GPUDeviceDescriptor {
    requiredFeatures?: string[];
    requiredLimits?: Record<string, number>;
}

interface GPUDevice {
    createBuffer(descriptor: GPUBufferDescriptor): GPUBuffer;
    createShaderModule(descriptor: { code: string }): GPUShaderModule;
    createRenderPipeline(descriptor: any): GPURenderPipeline;
    createBindGroupLayout(descriptor: any): GPUBindGroupLayout;
    createPipelineLayout(descriptor: any): GPUPipelineLayout;
    createBindGroup(descriptor: any): GPUBindGroup;
    createCommandEncoder(): GPUCommandEncoder;
    queue: GPUQueue;
}

interface GPUBuffer {
    readonly size: number;
    destroy(): void;
}

interface GPUBufferDescriptor {
    size: number;
    usage: number;
}

declare const GPUBufferUsage: {
    MAP_READ: number;
    MAP_WRITE: number;
    COPY_SRC: number;
    COPY_DST: number;
    INDEX: number;
    VERTEX: number;
    UNIFORM: number;
    STORAGE: number;
    INDIRECT: number;
    QUERY_RESOLVE: number;
};

declare const GPUShaderStage: {
    VERTEX: number;
    FRAGMENT: number;
    COMPUTE: number;
};

interface GPUShaderModule { }
interface GPURenderPipeline { }
interface GPUBindGroupLayout { }
interface GPUPipelineLayout { }
interface GPUBindGroup { }

interface GPUQueue {
    submit(commandBuffers: GPUCommandBuffer[]): void;
    writeBuffer(buffer: GPUBuffer, offset: number, data: ArrayBufferView): void;
}

interface GPUCommandEncoder {
    beginRenderPass(descriptor: GPURenderPassDescriptor): GPURenderPassEncoder;
    finish(): GPUCommandBuffer;
}

interface GPURenderPassDescriptor {
    colorAttachments: GPURenderPassColorAttachment[];
}

interface GPURenderPassColorAttachment {
    view: GPUTextureView;
    clearValue?: { r: number; g: number; b: number; a: number };
    loadOp: 'clear' | 'load';
    storeOp: 'store' | 'discard';
}

interface GPURenderPassEncoder {
    setPipeline(pipeline: GPURenderPipeline): void;
    setBindGroup(index: number, bindGroup: GPUBindGroup): void;
    draw(vertexCount: number, instanceCount?: number): void;
    end(): void;
}

interface GPUCommandBuffer { }
interface GPUTextureView { }
type GPUTextureFormat = string;

interface HTMLCanvasElement {
    getContext(contextId: 'webgpu'): GPUCanvasContext | null;
}

interface GPUCanvasContext {
    configure(config: { device: GPUDevice; format: GPUTextureFormat; alphaMode?: string }): void;
    getCurrentTexture(): GPUTexture;
}

interface GPUTexture {
    createView(): GPUTextureView;
}
