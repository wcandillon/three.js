export default class ParameterNodeCollection {

	constructor() {

		this.values = {};

	}

	set( key, value ) {

		this.values[ key ] = value;

	}

	[ Symbol.iterator ]() {

		let index = 0;
		const values = Object.values( this.values );
		return {
			next: () => ( {
				value: values[ index ],
				done: index ++ >= values.length
			} )
		};

	}

}
