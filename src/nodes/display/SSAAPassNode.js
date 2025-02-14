import { nodeObject } from '../shadernode/ShaderNode.js';
import PassNode from './PassNode.js';
import { Color } from '../../math/Color.js';
import { Vector2 } from '../../math/Vector2.js';
import { AdditiveBlending } from '../../constants.js';
import { uniform } from '../core/UniformNode.js';
import QuadMesh from '../../renderers/common/QuadMesh.js';
import { texture } from '../accessors/TextureNode.js';
import { mrt, getTextureIndex } from '../core/MRTNode.js';

const _size = /*@__PURE__*/ new Vector2();

/**
*
* Supersample Anti-Aliasing Render Pass
*
* This manual approach to SSAA re-renders the scene ones for each sample with camera jitter and accumulates the results.
*
* References: https://en.wikipedia.org/wiki/Supersampling
*
*/

class SSAAPassNode extends PassNode {

	constructor( scene, camera ) {

		super( PassNode.COLOR, scene, camera );

		this.isSSAAPassNode = true;

		this.sampleLevel = 4; // specified as n, where the number of samples is 2^n, so sampleLevel = 4, is 2^4 samples, 16.
		this.unbiased = true;
		this.clearColor = new Color( 0x000000 );
		this.clearAlpha = 0;

		this._currentClearColor = new Color();

		this.sampleWeight = uniform( 1 );

		this.sampleRenderTarget = null;

		this._quadMesh = new QuadMesh();

	}

	updateBefore( frame ) {

		const { renderer } = frame;
		const { scene, camera } = this;

		this._pixelRatio = renderer.getPixelRatio();

		const size = renderer.getSize( _size );

		this.setSize( size.width, size.height );
		this.sampleRenderTarget.setSize( this.renderTarget.width, this.renderTarget.height );

		// save current renderer settings

		renderer.getClearColor( this._currentClearColor );
		const currentClearAlpha = renderer.getClearAlpha();
		const currentRenderTarget = renderer.getRenderTarget();
		const currentMRT = renderer.getMRT();
		const currentAutoClear = renderer.autoClear;

		//

		this._cameraNear.value = camera.near;
		this._cameraFar.value = camera.far;

		renderer.setMRT( this.getMRT() );
		renderer.autoClear = false;

		const jitterOffsets = _JitterVectors[ Math.max( 0, Math.min( this.sampleLevel, 5 ) ) ];

		const baseSampleWeight = 1.0 / jitterOffsets.length;
		const roundingRange = 1 / 32;

		const viewOffset = {

			fullWidth: this.renderTarget.width,
			fullHeight: this.renderTarget.height,
			offsetX: 0,
			offsetY: 0,
			width: this.renderTarget.width,
			height: this.renderTarget.height

		};

		const originalViewOffset = Object.assign( {}, camera.view );

		if ( originalViewOffset.enabled ) Object.assign( viewOffset, originalViewOffset );

		// render the scene multiple times, each slightly jitter offset from the last and accumulate the results.

		for ( let i = 0; i < jitterOffsets.length; i ++ ) {

			const jitterOffset = jitterOffsets[ i ];

			if ( camera.setViewOffset ) {

				camera.setViewOffset(

					viewOffset.fullWidth, viewOffset.fullHeight,

					viewOffset.offsetX + jitterOffset[ 0 ] * 0.0625, viewOffset.offsetY + jitterOffset[ 1 ] * 0.0625, // 0.0625 = 1 / 16

					viewOffset.width, viewOffset.height

				);

			}

			this.sampleWeight.value = baseSampleWeight;

			if ( this.unbiased ) {

				// the theory is that equal weights for each sample lead to an accumulation of rounding errors.
				// The following equation varies the sampleWeight per sample so that it is uniformly distributed
				// across a range of values whose rounding errors cancel each other out.

				const uniformCenteredDistribution = ( - 0.5 + ( i + 0.5 ) / jitterOffsets.length );
				this.sampleWeight.value += roundingRange * uniformCenteredDistribution;

			}

			renderer.setClearColor( this.clearColor, this.clearAlpha );
			renderer.setRenderTarget( this.sampleRenderTarget );
			renderer.clear();
			renderer.render( scene, camera );

			// accumulation

			renderer.setRenderTarget( this.renderTarget );

			if ( i === 0 ) {

				renderer.setClearColor( 0x000000, 0.0 );
				renderer.clear();

			}

			this._quadMesh.render( renderer );

		}

		renderer.copyTextureToTexture( this.sampleRenderTarget.depthTexture, this.renderTarget.depthTexture );

		// restore

		if ( camera.setViewOffset && originalViewOffset.enabled ) {

			camera.setViewOffset(

				originalViewOffset.fullWidth, originalViewOffset.fullHeight,

				originalViewOffset.offsetX, originalViewOffset.offsetY,

				originalViewOffset.width, originalViewOffset.height

			);

		} else if ( camera.clearViewOffset ) {

			camera.clearViewOffset();

		}

		renderer.setRenderTarget( currentRenderTarget );
		renderer.setMRT( currentMRT );

		renderer.autoClear = currentAutoClear;
		renderer.setClearColor( this._currentClearColor, currentClearAlpha );

	}

	setup( builder ) {

		if ( this.sampleRenderTarget === null ) {

			this.sampleRenderTarget = this.renderTarget.clone();

		}

		let sampleTexture;

		const passMRT = this.getMRT();

		if ( passMRT !== null ) {

			const outputs = {};

			for ( const name in passMRT.outputNodes ) {

				const index = getTextureIndex( this.sampleRenderTarget.textures, name );

				if ( index >= 0 ) {

					outputs[ name ] = texture( this.sampleRenderTarget.textures[ index ] ).mul( this.sampleWeight );

				}

			}

			sampleTexture = mrt( outputs );

		} else {

			sampleTexture = texture( this.sampleRenderTarget.texture ).mul( this.sampleWeight );

		}

		this._quadMesh.material = builder.createNodeMaterial();
		this._quadMesh.material.fragmentNode = sampleTexture;
		this._quadMesh.material.transparent = true;
		this._quadMesh.material.depthTest = false;
		this._quadMesh.material.depthWrite = false;
		this._quadMesh.material.premultipliedAlpha = true;
		this._quadMesh.material.blending = AdditiveBlending;
		this._quadMesh.material.normals = false;
		this._quadMesh.material.name = 'SSAA';

		return super.setup( builder );

	}

	dispose() {

		super.dispose();

		if ( this.sampleRenderTarget !== null ) {

			this.sampleRenderTarget.dispose();

		}

	}

}

// These jitter vectors are specified in integers because it is easier.
// I am assuming a [-8,8) integer grid, but it needs to be mapped onto [-0.5,0.5)
// before being used, thus these integers need to be scaled by 1/16.
//
// Sample patterns reference: https://msdn.microsoft.com/en-us/library/windows/desktop/ff476218%28v=vs.85%29.aspx?f=255&MSPPError=-2147217396
const _JitterVectors = [
	[
		[ 0, 0 ]
	],
	[
		[ 4, 4 ], [ - 4, - 4 ]
	],
	[
		[ - 2, - 6 ], [ 6, - 2 ], [ - 6, 2 ], [ 2, 6 ]
	],
	[
		[ 1, - 3 ], [ - 1, 3 ], [ 5, 1 ], [ - 3, - 5 ],
		[ - 5, 5 ], [ - 7, - 1 ], [ 3, 7 ], [ 7, - 7 ]
	],
	[
		[ 1, 1 ], [ - 1, - 3 ], [ - 3, 2 ], [ 4, - 1 ],
		[ - 5, - 2 ], [ 2, 5 ], [ 5, 3 ], [ 3, - 5 ],
		[ - 2, 6 ], [ 0, - 7 ], [ - 4, - 6 ], [ - 6, 4 ],
		[ - 8, 0 ], [ 7, - 4 ], [ 6, 7 ], [ - 7, - 8 ]
	],
	[
		[ - 4, - 7 ], [ - 7, - 5 ], [ - 3, - 5 ], [ - 5, - 4 ],
		[ - 1, - 4 ], [ - 2, - 2 ], [ - 6, - 1 ], [ - 4, 0 ],
		[ - 7, 1 ], [ - 1, 2 ], [ - 6, 3 ], [ - 3, 3 ],
		[ - 7, 6 ], [ - 3, 6 ], [ - 5, 7 ], [ - 1, 7 ],
		[ 5, - 7 ], [ 1, - 6 ], [ 6, - 5 ], [ 4, - 4 ],
		[ 2, - 3 ], [ 7, - 2 ], [ 1, - 1 ], [ 4, - 1 ],
		[ 2, 1 ], [ 6, 2 ], [ 0, 4 ], [ 4, 4 ],
		[ 2, 5 ], [ 7, 5 ], [ 5, 6 ], [ 3, 7 ]
	]
];

export const ssaaPass = ( scene, camera ) => nodeObject( new SSAAPassNode( scene, camera ) );

export default SSAAPassNode;
