import { Guid } from "../utils";
import { Designer } from "../nodetest";
import {
  Property,
  FloatProperty,
  IntProperty,
  BoolProperty,
  EnumProperty,
  ColorProperty,
  StringProperty
} from "./properties";
import { buildShaderProgram } from "./gl";
import { Color } from "./color";

export class NodeInput {
  public node: DesignerNode;
  public name: string;
}

export class DesignerNode {
  public id: string = Guid.newGuid();
  public title: string;
  public typeName: string; // added when node is created from library

  public gl: WebGLRenderingContext;
  public designer: Designer;
  tex: WebGLTexture;
  //program:WebGLShader;
  source: string; // shader code
  shaderProgram: WebGLProgram;
  exportName: string;

  inputs: string[] = new Array();
  properties: Property[] = new Array();

  // tells scene to update the texture next frame
  needsUpdate: boolean = true;

  // callbacks
  onthumbnailgenerated: (DesignerNode, HTMLImageElement) => void;

  // an update is requested when:
  // a property is changed
  // a new connection is made
  // a connection is removed
  //
  // all output connected nodes are invalidated as well
  private requestUpdate() {
    this.designer.requestUpdate(this);
  }

  public render(inputs: NodeInput[]) {
    var gl = this.gl;
    // bind texture to fbo
    //gl.clearColor(0,0,1,1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // bind shader
    gl.useProgram(this.shaderProgram);

    // pass textures
    var texIndex = 0;
    for (let input of inputs) {
      gl.activeTexture(gl.TEXTURE0 + texIndex);
      gl.bindTexture(gl.TEXTURE_2D, input.node.tex);
      gl.uniform1i(
        gl.getUniformLocation(this.shaderProgram, input.name),
        texIndex
      );
      texIndex++;
    }

    // pass seed
    gl.uniform1f(
      gl.getUniformLocation(this.shaderProgram, "_seed"),
      this.designer.getRandomSeed()
    );

    // texture size
    gl.uniform2f(
      gl.getUniformLocation(this.shaderProgram, "_textureSize"),
      this.designer.width,
      this.designer.height
    );

    // pass properties
    for (let prop of this.properties) {
      if (prop instanceof FloatProperty) {
        gl.uniform1f(
          gl.getUniformLocation(this.shaderProgram, "prop_" + prop.name),
          (prop as FloatProperty).value
        );
      }
      if (prop instanceof IntProperty) {
        gl.uniform1i(
          gl.getUniformLocation(this.shaderProgram, "prop_" + prop.name),
          (prop as IntProperty).value
        );
      }
      if (prop instanceof BoolProperty) {
        gl.uniform1i(
          gl.getUniformLocation(this.shaderProgram, "prop_" + prop.name),
          (prop as BoolProperty).value == false ? 0 : 1
        );
      }
      if (prop instanceof EnumProperty) {
        gl.uniform1i(
          gl.getUniformLocation(this.shaderProgram, "prop_" + prop.name),
          (prop as EnumProperty).index
        );
      }
      if (prop instanceof ColorProperty) {
        var col = (prop as ColorProperty).value;
        gl.uniform4f(
          gl.getUniformLocation(this.shaderProgram, "prop_" + prop.name),
          col.r,
          col.g,
          col.b,
          col.a
        );
      }
    }

    // bind mesh
    var posLoc = gl.getAttribLocation(this.shaderProgram, "a_pos");
    var texCoordLoc = gl.getAttribLocation(this.shaderProgram, "a_texCoord");

    // provide texture coordinates for the rectangle.
    gl.bindBuffer(gl.ARRAY_BUFFER, this.designer.posBuffer);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.designer.texCoordBuffer);
    gl.enableVertexAttribArray(texCoordLoc);
    gl.vertexAttribPointer(texCoordLoc, 2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    gl.disableVertexAttribArray(posLoc);
    gl.disableVertexAttribArray(texCoordLoc);

    // render
  }

  public getInputs(): string[] {
    return this.inputs;
  }

  protected addInput(name: string) {
    this.inputs.push(name);
  }

  public setProperty(name: string, value: any) {
    //console.log(this.properties);
    for (let prop of this.properties) {
      if (prop.name == name) {
        prop.setValue(value);
        this.requestUpdate();
      }
    }
  }

  public _init() {
    //this.inputs = new Array();
    //this.properties = new Array();
    this.createTexture();

    this.init();
  }

  protected init() {
    /*
        this.source = `
        vec4 sample(vec2 uv)
        {
        return vec4(uv,x, uv.y, 0, 0);
        }
        `;

        this.buildShader(this.source);
        */
  }

  // #source gets appended to fragment shader
  buildShader(source: string) {
    var vertSource: string = `
        precision highp float;

        attribute vec3 a_pos;
        attribute vec2 a_texCoord;
            
        // the texCoords passed in from the vertex shader.
        varying vec2 v_texCoord;
            
        void main() {
            gl_Position = vec4(a_pos,1.0);
            v_texCoord = a_texCoord;
        }`;

    var fragSource: string = `
        precision highp float;
        varying vec2 v_texCoord;

        vec4 sample(vec2 uv);
        void initRandom();

        uniform vec2 _textureSize;
            
        void main() {
            initRandom();
            gl_FragColor = sample(v_texCoord);
        }

        `;

    fragSource =
      fragSource +
      this.createRandomLib() +
      this.createCodeForInputs() +
      this.createCodeForProps() +
      "#line 0\n" +
      source;

    this.shaderProgram = buildShaderProgram(this.gl, vertSource, fragSource);
  }

  // creates opengl texture for this node
  // gets the height from the scene
  // if the texture is already created, delete it and recreate it
  createTexture() {
    var gl = this.gl;

    if (this.tex) {
      gl.deleteTexture(this.tex);
      this.tex = null;
    }

    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);

    const level = 0;
    const internalFormat = gl.RGBA;
    const border = 0;
    const format = gl.RGBA;
    const type = gl.UNSIGNED_BYTE;
    const data = null;
    gl.texImage2D(
      gl.TEXTURE_2D,
      level,
      internalFormat,
      this.designer.width,
      this.designer.height,
      border,
      format,
      type,
      data
    );

    // set the filtering so we don't need mips
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);

    gl.bindTexture(gl.TEXTURE_2D, null);

    this.tex = tex;
  }

  createRandomLibOld(): string {
    // float _seed = `+this.designer.getRandomSeed().toFixed(1)+`;
    var code: string = `
        // this offsets the random start (should be a uniform)
        uniform float _seed;
        // this is the starting number for the rng
        // (should be set from the uv coordinates so it's unique per pixel)
        vec2 _randomStart;

        float _rand(vec2 co){
            return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453);
        }

        //todo: test variance!
        vec2 _rand2(vec2 co){
            return vec2(_rand(co), _rand(co + vec2(0.0001, 0.0001)));
        }

        float randomFloat(int index) 
        {
            return _rand(_randomStart + vec2(_seed) + vec2(index));
        }

        float randomVec2(int index) 
        {
            return _rand(_randomStart + vec2(_seed) + vec2(index));
        }

        float randomFloat(int index, float start, float end)
        {
            float r = _rand(_randomStart + vec2(_seed) + vec2(index));
            return start + r*(end-start);
        }

        int randomInt(int index, int start, int end)
        {
            float r = _rand(_randomStart + vec2(_seed) + vec2(index));
            return start + int(r*float(end-start));
        }

        bool randomBool(int index)
        {
            return _rand(_randomStart + vec2(_seed) + vec2(index)) > 0.5;
        }

        void initRandom()
        {
            _randomStart = v_texCoord;
        }
        `;

    return code;
  }

  createRandomLib(): string {
    // float _seed = `+this.designer.getRandomSeed().toFixed(1)+`;
    var code: string = `
        // this offsets the random start (should be a uniform)
        uniform float _seed;
        // this is the starting number for the rng
        // (should be set from the uv coordinates so it's unique per pixel)
        vec2 _randomStart;

        // gives a much better distribution at 1
        #define RANDOM_ITERATIONS 1

        #define HASHSCALE1 443.8975
        #define HASHSCALE3 vec3(443.897, 441.423, 437.195)
        #define HASHSCALE4 vec4(443.897, 441.423, 437.195, 444.129)

        //  1 out, 2 in...
        float hash12(vec2 p)
        {
            vec3 p3  = fract(vec3(p.xyx) * HASHSCALE1);
            p3 += dot(p3, p3.yzx + 19.19);
            return fract((p3.x + p3.y) * p3.z);
        }

        ///  2 out, 2 in...
        vec2 hash22(vec2 p)
        {
            vec3 p3 = fract(vec3(p.xyx) * HASHSCALE3);
            p3 += dot(p3, p3.yzx+19.19);
            return fract((p3.xx+p3.yz)*p3.zy);

        }


        float _rand(vec2 uv)
        {
            float a = 0.0;
            for (int t = 0; t < RANDOM_ITERATIONS; t++)
            {
                float v = float(t+1)*.152;
                // 0.005 is a good value
                vec2 pos = (uv * v);
                a += hash12(pos);
            }

            return a/float(RANDOM_ITERATIONS);
        }

        vec2 _rand2(vec2 uv)
        {
            vec2 a = vec2(0.0);
            for (int t = 0; t < RANDOM_ITERATIONS; t++)
            {
                float v = float(t+1)*.152;
                // 0.005 is a good value
                vec2 pos = (uv * v);
                a += hash22(pos);
            }

            return a/float(RANDOM_ITERATIONS);
        }

        float randomFloat(int index) 
        {
            return _rand(_randomStart + vec2(_seed) + vec2(index));
        }

        float randomVec2(int index) 
        {
            return _rand(_randomStart + vec2(_seed) + vec2(index));
        }

        float randomFloat(int index, float start, float end)
        {
            float r = _rand(_randomStart + vec2(_seed) + vec2(index));
            return start + r*(end-start);
        }

        int randomInt(int index, int start, int end)
        {
            float r = _rand(_randomStart + vec2(_seed) + vec2(index));
            return start + int(r*float(end-start));
        }

        bool randomBool(int index)
        {
            return _rand(_randomStart + vec2(_seed) + vec2(index)) > 0.5;
        }

        void initRandom()
        {
            _randomStart = v_texCoord;
        }
        `;

    return code;
  }

  createCodeForInputs() {
    var code: string = "";

    for (let input of this.inputs) {
      code += "uniform sampler2D " + input + ";\n";
    }

    return code;
  }

  createCodeForProps() {
    var code: string = "";

    //console.log(this.properties);
    //console.log(typeof FloatProperty);

    for (let prop of this.properties) {
      //code += "uniform sampler2D " + input + ";\n";
      if (prop instanceof FloatProperty) {
        code += "uniform float prop_" + prop.name + ";\n";
      }
      if (prop instanceof IntProperty) {
        code += "uniform int prop_" + prop.name + ";\n";
      }
      if (prop instanceof BoolProperty) {
        code += "uniform bool prop_" + prop.name + ";\n";
      }
      if (prop instanceof EnumProperty) {
        code += "uniform int prop_" + prop.name + ";\n";
      }
      if (prop instanceof ColorProperty) {
        code += "uniform vec4 prop_" + prop.name + ";\n";
      }
    }

    code += "\n";

    return code;
  }

  // PROPERTY FUNCTIONS
  addIntProperty(
    id: string,
    displayName: string,
    defaultVal: number = 1,
    minVal: number = 1,
    maxVal: number = 100,
    increment: number = 1
  ): IntProperty {
    var prop = new IntProperty(id, displayName, defaultVal);
    prop.minValue = minVal;
    prop.maxValue = maxVal;
    prop.step = increment;

    this.properties.push(prop);
    return prop;
  }

  addFloatProperty(
    id: string,
    displayName: string,
    defaultVal: number = 1,
    minVal: number = 1,
    maxVal: number = 100,
    increment: number = 1
  ): FloatProperty {
    var prop = new FloatProperty(id, displayName, defaultVal);
    prop.minValue = minVal;
    prop.maxValue = maxVal;
    prop.step = increment;

    this.properties.push(prop);
    return prop;
  }

  addBoolProperty(
    id: string,
    displayName: string,
    defaultVal: boolean = false
  ): BoolProperty {
    var prop = new BoolProperty(id, displayName, defaultVal);

    this.properties.push(prop);
    return prop;
  }

  addEnumProperty(
    id: string,
    displayName: string,
    defaultVal: string[] = new Array()
  ): EnumProperty {
    var prop = new EnumProperty(id, displayName, defaultVal);

    this.properties.push(prop);
    return prop;
  }

  addColorProperty(
    id: string,
    displayName: string,
    defaultVal: Color
  ): ColorProperty {
    var prop = new ColorProperty(id, displayName, defaultVal);

    this.properties.push(prop);
    return prop;
  }

  addStringProperty(
    id: string,
    displayName: string,
    defaultVal: string = ""
  ): StringProperty {
    var prop = new StringProperty(id, displayName, defaultVal);

    this.properties.push(prop);
    return prop;
  }
}
