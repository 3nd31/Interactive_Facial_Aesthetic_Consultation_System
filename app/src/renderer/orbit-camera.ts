/**
 * OrbitCamera — Mouse-controlled orbit camera for 3D viewport
 */

export class OrbitCamera {
    // Spherical coordinates
    private theta = 0;       // horizontal angle
    private phi = Math.PI / 6; // vertical angle (slightly above)
    private radius = 3;

    // Target point
    private target = [0, 0, 0];

    // Interaction state
    private isDragging = false;
    private lastX = 0;
    private lastY = 0;

    // Limits
    private minRadius = 1;
    private maxRadius = 10;
    private minPhi = 0.1;
    private maxPhi = Math.PI - 0.1;

    // Damping
    private thetaVelocity = 0;
    private phiVelocity = 0;
    private damping = 0.92;

    // Auto-rotate
    private autoRotate = true;
    private autoRotateSpeed = 0.003;

    constructor(canvas: HTMLElement) {
        this.bindEvents(canvas);
    }

    private bindEvents(el: HTMLElement): void {
        el.addEventListener('mousedown', (e) => {
            this.isDragging = true;
            this.autoRotate = false;
            this.lastX = e.clientX;
            this.lastY = e.clientY;
            el.style.cursor = 'grabbing';
        });

        window.addEventListener('mousemove', (e) => {
            if (!this.isDragging) return;
            const dx = e.clientX - this.lastX;
            const dy = e.clientY - this.lastY;
            this.lastX = e.clientX;
            this.lastY = e.clientY;

            this.thetaVelocity = -dx * 0.005;
            this.phiVelocity = -dy * 0.005;

            this.theta += this.thetaVelocity;
            this.phi = Math.max(this.minPhi, Math.min(this.maxPhi, this.phi + this.phiVelocity));
        });

        window.addEventListener('mouseup', () => {
            this.isDragging = false;
            el.style.cursor = 'grab';
        });

        el.addEventListener('wheel', (e) => {
            e.preventDefault();
            this.radius *= 1 + e.deltaY * 0.001;
            this.radius = Math.max(this.minRadius, Math.min(this.maxRadius, this.radius));
        }, { passive: false });

        el.addEventListener('dblclick', () => {
            this.theta = 0;
            this.phi = Math.PI / 6;
            this.radius = 3;
            this.autoRotate = true;
        });

        el.style.cursor = 'grab';
    }

    update(): void {
        if (this.autoRotate) {
            this.theta += this.autoRotateSpeed;
        } else if (!this.isDragging) {
            this.thetaVelocity *= this.damping;
            this.phiVelocity *= this.damping;
            this.theta += this.thetaVelocity;
            this.phi = Math.max(this.minPhi, Math.min(this.maxPhi, this.phi + this.phiVelocity));
        }
    }

    getPosition(): [number, number, number] {
        const x = this.radius * Math.sin(this.phi) * Math.sin(this.theta) + this.target[0];
        const y = this.radius * Math.cos(this.phi) + this.target[1];
        const z = this.radius * Math.sin(this.phi) * Math.cos(this.theta) + this.target[2];
        return [x, y, z];
    }

    getTarget(): [number, number, number] {
        return this.target as [number, number, number];
    }

    getViewMatrix(): Float32Array {
        const eye = this.getPosition();
        return lookAt(eye, this.target, [0, 1, 0]);
    }

    getProjectionMatrix(aspect: number): Float32Array {
        return perspective(Math.PI / 4, aspect, 0.01, 100);
    }
}

// --- Math utilities ---
function perspective(fov: number, aspect: number, near: number, far: number): Float32Array {
    const f = 1.0 / Math.tan(fov / 2);
    const rangeInv = 1.0 / (near - far);
    const m = new Float32Array(16);
    m[0] = f / aspect;
    m[5] = f;
    m[10] = (near + far) * rangeInv;
    m[11] = -1;
    m[14] = 2 * near * far * rangeInv;
    return m;
}

function lookAt(eye: number[], target: number[], up: number[]): Float32Array {
    const zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
    let len = Math.sqrt(zx * zx + zy * zy + zz * zz);
    if (len === 0) len = 1;
    const iz = 1 / len;
    const z = [zx * iz, zy * iz, zz * iz];

    const xx = up[1] * z[2] - up[2] * z[1];
    const xy = up[2] * z[0] - up[0] * z[2];
    const xz = up[0] * z[1] - up[1] * z[0];
    len = Math.sqrt(xx * xx + xy * xy + xz * xz);
    if (len === 0) len = 1;
    const ix = 1 / len;
    const x = [xx * ix, xy * ix, xz * ix];

    const y = [
        z[1] * x[2] - z[2] * x[1],
        z[2] * x[0] - z[0] * x[2],
        z[0] * x[1] - z[1] * x[0],
    ];

    const m = new Float32Array(16);
    m[0] = x[0]; m[1] = y[0]; m[2] = z[0]; m[3] = 0;
    m[4] = x[1]; m[5] = y[1]; m[6] = z[1]; m[7] = 0;
    m[8] = x[2]; m[9] = y[2]; m[10] = z[2]; m[11] = 0;
    m[12] = -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]);
    m[13] = -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]);
    m[14] = -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]);
    m[15] = 1;
    return m;
}

export function multiplyMatrices(a: Float32Array, b: Float32Array): Float32Array {
    const r = new Float32Array(16);
    for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
            r[i * 4 + j] =
                a[i * 4 + 0] * b[0 + j] +
                a[i * 4 + 1] * b[4 + j] +
                a[i * 4 + 2] * b[8 + j] +
                a[i * 4 + 3] * b[12 + j];
        }
    }
    return r;
}
