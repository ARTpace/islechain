(()=>{/**
 * @license
 * Copyright 2010-2025 Three.js Authors
 * SPDX-License-Identifier: MIT
 */var zt=0,Ua=1,di=2;var rr=1;var or=100;var ar=204,cr=205;var wr=0,Ar=1,Er=2,$n=3,Rr=4,Cr=5,Ir=6,Pr=7,fs=0;var lr="attached",Na="detached",Lr=300;var Dr=303;var Ce=1e3,Re=1001,Jt=1002,kt=1003,pi=1004;var mi=1005;var nt=1006,gi=1007;var ht=1008;var Ur=1009;var ds=1015;var xi=1023;var Fa=1028;var vt=2300,Mt=2301,ji=2302,hr=2400,ur=2401,fr=2402,Oa=2500;var Nr=0,_i=1,Fn=2;var ps=0;var yi="",O="srgb",ze="srgb-linear",dr="linear",$i="srgb";var Zt=7680;var pr=519;var Qi=35044;var Bt=2e3,es=2001;var jt=class{addEventListener(e,t){this._listeners===void 0&&(this._listeners={});let n=this._listeners;n[e]===void 0&&(n[e]=[]),n[e].indexOf(t)===-1&&n[e].push(t)}hasEventListener(e,t){let n=this._listeners;return n===void 0?!1:n[e]!==void 0&&n[e].indexOf(t)!==-1}removeEventListener(e,t){let n=this._listeners;if(n===void 0)return;let i=n[e];if(i!==void 0){let s=i.indexOf(t);s!==-1&&i.splice(s,1)}}dispatchEvent(e){let t=this._listeners;if(t===void 0)return;let n=t[e.type];if(n!==void 0){e.target=this;let i=n.slice(0);for(let s=0,r=i.length;s<r;s++)i[s].call(this,e);e.target=null}}},Me=["00","01","02","03","04","05","06","07","08","09","0a","0b","0c","0d","0e","0f","10","11","12","13","14","15","16","17","18","19","1a","1b","1c","1d","1e","1f","20","21","22","23","24","25","26","27","28","29","2a","2b","2c","2d","2e","2f","30","31","32","33","34","35","36","37","38","39","3a","3b","3c","3d","3e","3f","40","41","42","43","44","45","46","47","48","49","4a","4b","4c","4d","4e","4f","50","51","52","53","54","55","56","57","58","59","5a","5b","5c","5d","5e","5f","60","61","62","63","64","65","66","67","68","69","6a","6b","6c","6d","6e","6f","70","71","72","73","74","75","76","77","78","79","7a","7b","7c","7d","7e","7f","80","81","82","83","84","85","86","87","88","89","8a","8b","8c","8d","8e","8f","90","91","92","93","94","95","96","97","98","99","9a","9b","9c","9d","9e","9f","a0","a1","a2","a3","a4","a5","a6","a7","a8","a9","aa","ab","ac","ad","ae","af","b0","b1","b2","b3","b4","b5","b6","b7","b8","b9","ba","bb","bc","bd","be","bf","c0","c1","c2","c3","c4","c5","c6","c7","c8","c9","ca","cb","cc","cd","ce","cf","d0","d1","d2","d3","d4","d5","d6","d7","d8","d9","da","db","dc","dd","de","df","e0","e1","e2","e3","e4","e5","e6","e7","e8","e9","ea","eb","ec","ed","ee","ef","f0","f1","f2","f3","f4","f5","f6","f7","f8","f9","fa","fb","fc","fd","fe","ff"],Zo=1234567,Jn=Math.PI/180,wn=180/Math.PI;function it(){let l=Math.random()*4294967295|0,e=Math.random()*4294967295|0,t=Math.random()*4294967295|0,n=Math.random()*4294967295|0;return(Me[l&255]+Me[l>>8&255]+Me[l>>16&255]+Me[l>>24&255]+"-"+Me[e&255]+Me[e>>8&255]+"-"+Me[e>>16&15|64]+Me[e>>24&255]+"-"+Me[t&63|128]+Me[t>>8&255]+"-"+Me[t>>16&255]+Me[t>>24&255]+Me[n&255]+Me[n>>8&255]+Me[n>>16&255]+Me[n>>24&255]).toLowerCase()}function G(l,e,t){return Math.max(e,Math.min(t,l))}function Fr(l,e){return(l%e+e)%e}function Tc(l,e,t,n,i){return n+(l-e)*(i-n)/(t-e)}function bc(l,e,t){return l!==e?(t-l)/(e-l):0}function jn(l,e,t){return(1-t)*l+t*e}function wc(l,e,t,n){return jn(l,e,1-Math.exp(-t*n))}function Ac(l,e=1){return e-Math.abs(Fr(l,e*2)-e)}function Ec(l,e,t){return l<=e?0:l>=t?1:(l=(l-e)/(t-e),l*l*(3-2*l))}function Rc(l,e,t){return l<=e?0:l>=t?1:(l=(l-e)/(t-e),l*l*l*(l*(l*6-15)+10))}function Cc(l,e){return l+Math.floor(Math.random()*(e-l+1))}function Ic(l,e){return l+Math.random()*(e-l)}function Pc(l){return l*(.5-Math.random())}function Lc(l){l!==void 0&&(Zo=l);let e=Zo+=1831565813;return e=Math.imul(e^e>>>15,e|1),e^=e+Math.imul(e^e>>>7,e|61),((e^e>>>14)>>>0)/4294967296}function Dc(l){return l*Jn}function Uc(l){return l*wn}function Nc(l){return(l&l-1)===0&&l!==0}function Fc(l){return Math.pow(2,Math.ceil(Math.log(l)/Math.LN2))}function Oc(l){return Math.pow(2,Math.floor(Math.log(l)/Math.LN2))}function Bc(l,e,t,n,i){let s=Math.cos,r=Math.sin,o=s(t/2),a=r(t/2),c=s((e+n)/2),u=r((e+n)/2),h=s((e-n)/2),f=r((e-n)/2),d=s((n-e)/2),p=r((n-e)/2);switch(i){case"XYX":l.set(o*u,a*h,a*f,o*c);break;case"YZY":l.set(a*f,o*u,a*h,o*c);break;case"ZXZ":l.set(a*h,a*f,o*u,o*c);break;case"XZX":l.set(o*u,a*p,a*d,o*c);break;case"YXY":l.set(a*d,o*u,a*p,o*c);break;case"ZYZ":l.set(a*p,a*d,o*u,o*c);break;default:console.warn("THREE.MathUtils: .setQuaternionFromProperEuler() encountered an unknown order: "+i)}}function tt(l,e){switch(e.constructor){case Float32Array:return l;case Uint32Array:return l/4294967295;case Uint16Array:return l/65535;case Uint8Array:return l/255;case Int32Array:return Math.max(l/2147483647,-1);case Int16Array:return Math.max(l/32767,-1);case Int8Array:return Math.max(l/127,-1);default:throw new Error("Invalid component type.")}}function ie(l,e){switch(e.constructor){case Float32Array:return l;case Uint32Array:return Math.round(l*4294967295);case Uint16Array:return Math.round(l*65535);case Uint8Array:return Math.round(l*255);case Int32Array:return Math.round(l*2147483647);case Int16Array:return Math.round(l*32767);case Int8Array:return Math.round(l*127);default:throw new Error("Invalid component type.")}}var pe={DEG2RAD:Jn,RAD2DEG:wn,generateUUID:it,clamp:G,euclideanModulo:Fr,mapLinear:Tc,inverseLerp:bc,lerp:jn,damp:wc,pingpong:Ac,smoothstep:Ec,smootherstep:Rc,randInt:Cc,randFloat:Ic,randFloatSpread:Pc,seededRandom:Lc,degToRad:Dc,radToDeg:Uc,isPowerOfTwo:Nc,ceilPowerOfTwo:Fc,floorPowerOfTwo:Oc,setQuaternionFromProperEuler:Bc,normalize:ie,denormalize:tt},Z=class l{constructor(e=0,t=0){l.prototype.isVector2=!0,this.x=e,this.y=t}get width(){return this.x}set width(e){this.x=e}get height(){return this.y}set height(e){this.y=e}set(e,t){return this.x=e,this.y=t,this}setScalar(e){return this.x=e,this.y=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y)}copy(e){return this.x=e.x,this.y=e.y,this}add(e){return this.x+=e.x,this.y+=e.y,this}addScalar(e){return this.x+=e,this.y+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this}subScalar(e){return this.x-=e,this.y-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this}multiply(e){return this.x*=e.x,this.y*=e.y,this}multiplyScalar(e){return this.x*=e,this.y*=e,this}divide(e){return this.x/=e.x,this.y/=e.y,this}divideScalar(e){return this.multiplyScalar(1/e)}applyMatrix3(e){let t=this.x,n=this.y,i=e.elements;return this.x=i[0]*t+i[3]*n+i[6],this.y=i[1]*t+i[4]*n+i[7],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this}clamp(e,t){return this.x=G(this.x,e.x,t.x),this.y=G(this.y,e.y,t.y),this}clampScalar(e,t){return this.x=G(this.x,e,t),this.y=G(this.y,e,t),this}clampLength(e,t){let n=this.length();return this.divideScalar(n||1).multiplyScalar(G(n,e,t))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this}negate(){return this.x=-this.x,this.y=-this.y,this}dot(e){return this.x*e.x+this.y*e.y}cross(e){return this.x*e.y-this.y*e.x}lengthSq(){return this.x*this.x+this.y*this.y}length(){return Math.sqrt(this.x*this.x+this.y*this.y)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)}normalize(){return this.divideScalar(this.length()||1)}angle(){return Math.atan2(-this.y,-this.x)+Math.PI}angleTo(e){let t=Math.sqrt(this.lengthSq()*e.lengthSq());if(t===0)return Math.PI/2;let n=this.dot(e)/t;return Math.acos(G(n,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){let t=this.x-e.x,n=this.y-e.y;return t*t+n*n}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this}equals(e){return e.x===this.x&&e.y===this.y}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this}rotateAround(e,t){let n=Math.cos(t),i=Math.sin(t),s=this.x-e.x,r=this.y-e.y;return this.x=s*n-r*i+e.x,this.y=s*i+r*n+e.y,this}random(){return this.x=Math.random(),this.y=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y}},fe=class{constructor(e=0,t=0,n=0,i=1){this.isQuaternion=!0,this._x=e,this._y=t,this._z=n,this._w=i}static slerpFlat(e,t,n,i,s,r,o){let a=n[i+0],c=n[i+1],u=n[i+2],h=n[i+3],f=s[r+0],d=s[r+1],p=s[r+2],g=s[r+3];if(o===0){e[t+0]=a,e[t+1]=c,e[t+2]=u,e[t+3]=h;return}if(o===1){e[t+0]=f,e[t+1]=d,e[t+2]=p,e[t+3]=g;return}if(h!==g||a!==f||c!==d||u!==p){let m=1-o,x=a*f+c*d+u*p+h*g,v=x>=0?1:-1,y=1-x*x;if(y>Number.EPSILON){let S=Math.sqrt(y),T=Math.atan2(S,x*v);m=Math.sin(m*T)/S,o=Math.sin(o*T)/S}let _=o*v;if(a=a*m+f*_,c=c*m+d*_,u=u*m+p*_,h=h*m+g*_,m===1-o){let S=1/Math.sqrt(a*a+c*c+u*u+h*h);a*=S,c*=S,u*=S,h*=S}}e[t]=a,e[t+1]=c,e[t+2]=u,e[t+3]=h}static multiplyQuaternionsFlat(e,t,n,i,s,r){let o=n[i],a=n[i+1],c=n[i+2],u=n[i+3],h=s[r],f=s[r+1],d=s[r+2],p=s[r+3];return e[t]=o*p+u*h+a*d-c*f,e[t+1]=a*p+u*f+c*h-o*d,e[t+2]=c*p+u*d+o*f-a*h,e[t+3]=u*p-o*h-a*f-c*d,e}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get w(){return this._w}set w(e){this._w=e,this._onChangeCallback()}set(e,t,n,i){return this._x=e,this._y=t,this._z=n,this._w=i,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._w)}copy(e){return this._x=e.x,this._y=e.y,this._z=e.z,this._w=e.w,this._onChangeCallback(),this}setFromEuler(e,t=!0){let n=e._x,i=e._y,s=e._z,r=e._order,o=Math.cos,a=Math.sin,c=o(n/2),u=o(i/2),h=o(s/2),f=a(n/2),d=a(i/2),p=a(s/2);switch(r){case"XYZ":this._x=f*u*h+c*d*p,this._y=c*d*h-f*u*p,this._z=c*u*p+f*d*h,this._w=c*u*h-f*d*p;break;case"YXZ":this._x=f*u*h+c*d*p,this._y=c*d*h-f*u*p,this._z=c*u*p-f*d*h,this._w=c*u*h+f*d*p;break;case"ZXY":this._x=f*u*h-c*d*p,this._y=c*d*h+f*u*p,this._z=c*u*p+f*d*h,this._w=c*u*h-f*d*p;break;case"ZYX":this._x=f*u*h-c*d*p,this._y=c*d*h+f*u*p,this._z=c*u*p-f*d*h,this._w=c*u*h+f*d*p;break;case"YZX":this._x=f*u*h+c*d*p,this._y=c*d*h+f*u*p,this._z=c*u*p-f*d*h,this._w=c*u*h-f*d*p;break;case"XZY":this._x=f*u*h-c*d*p,this._y=c*d*h-f*u*p,this._z=c*u*p+f*d*h,this._w=c*u*h+f*d*p;break;default:console.warn("THREE.Quaternion: .setFromEuler() encountered an unknown order: "+r)}return t===!0&&this._onChangeCallback(),this}setFromAxisAngle(e,t){let n=t/2,i=Math.sin(n);return this._x=e.x*i,this._y=e.y*i,this._z=e.z*i,this._w=Math.cos(n),this._onChangeCallback(),this}setFromRotationMatrix(e){let t=e.elements,n=t[0],i=t[4],s=t[8],r=t[1],o=t[5],a=t[9],c=t[2],u=t[6],h=t[10],f=n+o+h;if(f>0){let d=.5/Math.sqrt(f+1);this._w=.25/d,this._x=(u-a)*d,this._y=(s-c)*d,this._z=(r-i)*d}else if(n>o&&n>h){let d=2*Math.sqrt(1+n-o-h);this._w=(u-a)/d,this._x=.25*d,this._y=(i+r)/d,this._z=(s+c)/d}else if(o>h){let d=2*Math.sqrt(1+o-n-h);this._w=(s-c)/d,this._x=(i+r)/d,this._y=.25*d,this._z=(a+u)/d}else{let d=2*Math.sqrt(1+h-n-o);this._w=(r-i)/d,this._x=(s+c)/d,this._y=(a+u)/d,this._z=.25*d}return this._onChangeCallback(),this}setFromUnitVectors(e,t){let n=e.dot(t)+1;return n<1e-8?(n=0,Math.abs(e.x)>Math.abs(e.z)?(this._x=-e.y,this._y=e.x,this._z=0,this._w=n):(this._x=0,this._y=-e.z,this._z=e.y,this._w=n)):(this._x=e.y*t.z-e.z*t.y,this._y=e.z*t.x-e.x*t.z,this._z=e.x*t.y-e.y*t.x,this._w=n),this.normalize()}angleTo(e){return 2*Math.acos(Math.abs(G(this.dot(e),-1,1)))}rotateTowards(e,t){let n=this.angleTo(e);if(n===0)return this;let i=Math.min(1,t/n);return this.slerp(e,i),this}identity(){return this.set(0,0,0,1)}invert(){return this.conjugate()}conjugate(){return this._x*=-1,this._y*=-1,this._z*=-1,this._onChangeCallback(),this}dot(e){return this._x*e._x+this._y*e._y+this._z*e._z+this._w*e._w}lengthSq(){return this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w}length(){return Math.sqrt(this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w)}normalize(){let e=this.length();return e===0?(this._x=0,this._y=0,this._z=0,this._w=1):(e=1/e,this._x=this._x*e,this._y=this._y*e,this._z=this._z*e,this._w=this._w*e),this._onChangeCallback(),this}multiply(e){return this.multiplyQuaternions(this,e)}premultiply(e){return this.multiplyQuaternions(e,this)}multiplyQuaternions(e,t){let n=e._x,i=e._y,s=e._z,r=e._w,o=t._x,a=t._y,c=t._z,u=t._w;return this._x=n*u+r*o+i*c-s*a,this._y=i*u+r*a+s*o-n*c,this._z=s*u+r*c+n*a-i*o,this._w=r*u-n*o-i*a-s*c,this._onChangeCallback(),this}slerp(e,t){if(t===0)return this;if(t===1)return this.copy(e);let n=this._x,i=this._y,s=this._z,r=this._w,o=r*e._w+n*e._x+i*e._y+s*e._z;if(o<0?(this._w=-e._w,this._x=-e._x,this._y=-e._y,this._z=-e._z,o=-o):this.copy(e),o>=1)return this._w=r,this._x=n,this._y=i,this._z=s,this;let a=1-o*o;if(a<=Number.EPSILON){let d=1-t;return this._w=d*r+t*this._w,this._x=d*n+t*this._x,this._y=d*i+t*this._y,this._z=d*s+t*this._z,this.normalize(),this}let c=Math.sqrt(a),u=Math.atan2(c,o),h=Math.sin((1-t)*u)/c,f=Math.sin(t*u)/c;return this._w=r*h+this._w*f,this._x=n*h+this._x*f,this._y=i*h+this._y*f,this._z=s*h+this._z*f,this._onChangeCallback(),this}slerpQuaternions(e,t,n){return this.copy(e).slerp(t,n)}random(){let e=2*Math.PI*Math.random(),t=2*Math.PI*Math.random(),n=Math.random(),i=Math.sqrt(1-n),s=Math.sqrt(n);return this.set(i*Math.sin(e),i*Math.cos(e),s*Math.sin(t),s*Math.cos(t))}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._w===this._w}fromArray(e,t=0){return this._x=e[t],this._y=e[t+1],this._z=e[t+2],this._w=e[t+3],this._onChangeCallback(),this}toArray(e=[],t=0){return e[t]=this._x,e[t+1]=this._y,e[t+2]=this._z,e[t+3]=this._w,e}fromBufferAttribute(e,t){return this._x=e.getX(t),this._y=e.getY(t),this._z=e.getZ(t),this._w=e.getW(t),this._onChangeCallback(),this}toJSON(){return this.toArray()}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._w}},M=class l{constructor(e=0,t=0,n=0){l.prototype.isVector3=!0,this.x=e,this.y=t,this.z=n}set(e,t,n){return n===void 0&&(n=this.z),this.x=e,this.y=t,this.z=n,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;case 2:this.z=t;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this.z=e.z+t.z,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this.z+=e.z*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this.z=e.z-t.z,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this}multiplyVectors(e,t){return this.x=e.x*t.x,this.y=e.y*t.y,this.z=e.z*t.z,this}applyEuler(e){return this.applyQuaternion(Jo.setFromEuler(e))}applyAxisAngle(e,t){return this.applyQuaternion(Jo.setFromAxisAngle(e,t))}applyMatrix3(e){let t=this.x,n=this.y,i=this.z,s=e.elements;return this.x=s[0]*t+s[3]*n+s[6]*i,this.y=s[1]*t+s[4]*n+s[7]*i,this.z=s[2]*t+s[5]*n+s[8]*i,this}applyNormalMatrix(e){return this.applyMatrix3(e).normalize()}applyMatrix4(e){let t=this.x,n=this.y,i=this.z,s=e.elements,r=1/(s[3]*t+s[7]*n+s[11]*i+s[15]);return this.x=(s[0]*t+s[4]*n+s[8]*i+s[12])*r,this.y=(s[1]*t+s[5]*n+s[9]*i+s[13])*r,this.z=(s[2]*t+s[6]*n+s[10]*i+s[14])*r,this}applyQuaternion(e){let t=this.x,n=this.y,i=this.z,s=e.x,r=e.y,o=e.z,a=e.w,c=2*(r*i-o*n),u=2*(o*t-s*i),h=2*(s*n-r*t);return this.x=t+a*c+r*h-o*u,this.y=n+a*u+o*c-s*h,this.z=i+a*h+s*u-r*c,this}project(e){return this.applyMatrix4(e.matrixWorldInverse).applyMatrix4(e.projectionMatrix)}unproject(e){return this.applyMatrix4(e.projectionMatrixInverse).applyMatrix4(e.matrixWorld)}transformDirection(e){let t=this.x,n=this.y,i=this.z,s=e.elements;return this.x=s[0]*t+s[4]*n+s[8]*i,this.y=s[1]*t+s[5]*n+s[9]*i,this.z=s[2]*t+s[6]*n+s[10]*i,this.normalize()}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this}divideScalar(e){return this.multiplyScalar(1/e)}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this}clamp(e,t){return this.x=G(this.x,e.x,t.x),this.y=G(this.y,e.y,t.y),this.z=G(this.z,e.z,t.z),this}clampScalar(e,t){return this.x=G(this.x,e,t),this.y=G(this.y,e,t),this.z=G(this.z,e,t),this}clampLength(e,t){let n=this.length();return this.divideScalar(n||1).multiplyScalar(G(n,e,t))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this.z+=(e.z-this.z)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this.z=e.z+(t.z-e.z)*n,this}cross(e){return this.crossVectors(this,e)}crossVectors(e,t){let n=e.x,i=e.y,s=e.z,r=t.x,o=t.y,a=t.z;return this.x=i*a-s*o,this.y=s*r-n*a,this.z=n*o-i*r,this}projectOnVector(e){let t=e.lengthSq();if(t===0)return this.set(0,0,0);let n=e.dot(this)/t;return this.copy(e).multiplyScalar(n)}projectOnPlane(e){return Ls.copy(this).projectOnVector(e),this.sub(Ls)}reflect(e){return this.sub(Ls.copy(e).multiplyScalar(2*this.dot(e)))}angleTo(e){let t=Math.sqrt(this.lengthSq()*e.lengthSq());if(t===0)return Math.PI/2;let n=this.dot(e)/t;return Math.acos(G(n,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){let t=this.x-e.x,n=this.y-e.y,i=this.z-e.z;return t*t+n*n+i*i}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)+Math.abs(this.z-e.z)}setFromSpherical(e){return this.setFromSphericalCoords(e.radius,e.phi,e.theta)}setFromSphericalCoords(e,t,n){let i=Math.sin(t)*e;return this.x=i*Math.sin(n),this.y=Math.cos(t)*e,this.z=i*Math.cos(n),this}setFromCylindrical(e){return this.setFromCylindricalCoords(e.radius,e.theta,e.y)}setFromCylindricalCoords(e,t,n){return this.x=e*Math.sin(t),this.y=n,this.z=e*Math.cos(t),this}setFromMatrixPosition(e){let t=e.elements;return this.x=t[12],this.y=t[13],this.z=t[14],this}setFromMatrixScale(e){let t=this.setFromMatrixColumn(e,0).length(),n=this.setFromMatrixColumn(e,1).length(),i=this.setFromMatrixColumn(e,2).length();return this.x=t,this.y=n,this.z=i,this}setFromMatrixColumn(e,t){return this.fromArray(e.elements,t*4)}setFromMatrix3Column(e,t){return this.fromArray(e.elements,t*3)}setFromEuler(e){return this.x=e._x,this.y=e._y,this.z=e._z,this}setFromColor(e){return this.x=e.r,this.y=e.g,this.z=e.b,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this.z=e[t+2],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e[t+2]=this.z,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this.z=e.getZ(t),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this}randomDirection(){let e=Math.random()*Math.PI*2,t=Math.random()*2-1,n=Math.sqrt(1-t*t);return this.x=n*Math.cos(e),this.y=t,this.z=n*Math.sin(e),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z}},Ls=new M,Jo=new fe,k=class l{constructor(e,t,n,i,s,r,o,a,c){l.prototype.isMatrix3=!0,this.elements=[1,0,0,0,1,0,0,0,1],e!==void 0&&this.set(e,t,n,i,s,r,o,a,c)}set(e,t,n,i,s,r,o,a,c){let u=this.elements;return u[0]=e,u[1]=i,u[2]=o,u[3]=t,u[4]=s,u[5]=a,u[6]=n,u[7]=r,u[8]=c,this}identity(){return this.set(1,0,0,0,1,0,0,0,1),this}copy(e){let t=this.elements,n=e.elements;return t[0]=n[0],t[1]=n[1],t[2]=n[2],t[3]=n[3],t[4]=n[4],t[5]=n[5],t[6]=n[6],t[7]=n[7],t[8]=n[8],this}extractBasis(e,t,n){return e.setFromMatrix3Column(this,0),t.setFromMatrix3Column(this,1),n.setFromMatrix3Column(this,2),this}setFromMatrix4(e){let t=e.elements;return this.set(t[0],t[4],t[8],t[1],t[5],t[9],t[2],t[6],t[10]),this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,t){let n=e.elements,i=t.elements,s=this.elements,r=n[0],o=n[3],a=n[6],c=n[1],u=n[4],h=n[7],f=n[2],d=n[5],p=n[8],g=i[0],m=i[3],x=i[6],v=i[1],y=i[4],_=i[7],S=i[2],T=i[5],b=i[8];return s[0]=r*g+o*v+a*S,s[3]=r*m+o*y+a*T,s[6]=r*x+o*_+a*b,s[1]=c*g+u*v+h*S,s[4]=c*m+u*y+h*T,s[7]=c*x+u*_+h*b,s[2]=f*g+d*v+p*S,s[5]=f*m+d*y+p*T,s[8]=f*x+d*_+p*b,this}multiplyScalar(e){let t=this.elements;return t[0]*=e,t[3]*=e,t[6]*=e,t[1]*=e,t[4]*=e,t[7]*=e,t[2]*=e,t[5]*=e,t[8]*=e,this}determinant(){let e=this.elements,t=e[0],n=e[1],i=e[2],s=e[3],r=e[4],o=e[5],a=e[6],c=e[7],u=e[8];return t*r*u-t*o*c-n*s*u+n*o*a+i*s*c-i*r*a}invert(){let e=this.elements,t=e[0],n=e[1],i=e[2],s=e[3],r=e[4],o=e[5],a=e[6],c=e[7],u=e[8],h=u*r-o*c,f=o*a-u*s,d=c*s-r*a,p=t*h+n*f+i*d;if(p===0)return this.set(0,0,0,0,0,0,0,0,0);let g=1/p;return e[0]=h*g,e[1]=(i*c-u*n)*g,e[2]=(o*n-i*r)*g,e[3]=f*g,e[4]=(u*t-i*a)*g,e[5]=(i*s-o*t)*g,e[6]=d*g,e[7]=(n*a-c*t)*g,e[8]=(r*t-n*s)*g,this}transpose(){let e,t=this.elements;return e=t[1],t[1]=t[3],t[3]=e,e=t[2],t[2]=t[6],t[6]=e,e=t[5],t[5]=t[7],t[7]=e,this}getNormalMatrix(e){return this.setFromMatrix4(e).invert().transpose()}transposeIntoArray(e){let t=this.elements;return e[0]=t[0],e[1]=t[3],e[2]=t[6],e[3]=t[1],e[4]=t[4],e[5]=t[7],e[6]=t[2],e[7]=t[5],e[8]=t[8],this}setUvTransform(e,t,n,i,s,r,o){let a=Math.cos(s),c=Math.sin(s);return this.set(n*a,n*c,-n*(a*r+c*o)+r+e,-i*c,i*a,-i*(-c*r+a*o)+o+t,0,0,1),this}scale(e,t){return this.premultiply(Ds.makeScale(e,t)),this}rotate(e){return this.premultiply(Ds.makeRotation(-e)),this}translate(e,t){return this.premultiply(Ds.makeTranslation(e,t)),this}makeTranslation(e,t){return e.isVector2?this.set(1,0,e.x,0,1,e.y,0,0,1):this.set(1,0,e,0,1,t,0,0,1),this}makeRotation(e){let t=Math.cos(e),n=Math.sin(e);return this.set(t,-n,0,n,t,0,0,0,1),this}makeScale(e,t){return this.set(e,0,0,0,t,0,0,0,1),this}equals(e){let t=this.elements,n=e.elements;for(let i=0;i<9;i++)if(t[i]!==n[i])return!1;return!0}fromArray(e,t=0){for(let n=0;n<9;n++)this.elements[n]=e[n+t];return this}toArray(e=[],t=0){let n=this.elements;return e[t]=n[0],e[t+1]=n[1],e[t+2]=n[2],e[t+3]=n[3],e[t+4]=n[4],e[t+5]=n[5],e[t+6]=n[6],e[t+7]=n[7],e[t+8]=n[8],e}clone(){return new this.constructor().fromArray(this.elements)}},Ds=new k;function Ba(l){for(let e=l.length-1;e>=0;--e)if(l[e]>=65535)return!0;return!1}function ts(l){return document.createElementNS("http://www.w3.org/1999/xhtml",l)}var jo={};function mr(l){l in jo||(jo[l]=!0,console.warn(l))}var $o=new k().set(.4123908,.3575843,.1804808,.212639,.7151687,.0721923,.0193308,.1191948,.9505322),Qo=new k().set(3.2409699,-1.5373832,-.4986108,-.9692436,1.8759675,.0415551,.0556301,-.203977,1.0569715);function zc(){let l={enabled:!0,workingColorSpace:ze,spaces:{},convert:function(i,s,r){return this.enabled===!1||s===r||!s||!r||(this.spaces[s].transfer===$i&&(i.r=yt(i.r),i.g=yt(i.g),i.b=yt(i.b)),this.spaces[s].primaries!==this.spaces[r].primaries&&(i.applyMatrix3(this.spaces[s].toXYZ),i.applyMatrix3(this.spaces[r].fromXYZ)),this.spaces[r].transfer===$i&&(i.r=bn(i.r),i.g=bn(i.g),i.b=bn(i.b))),i},workingToColorSpace:function(i,s){return this.convert(i,this.workingColorSpace,s)},colorSpaceToWorking:function(i,s){return this.convert(i,s,this.workingColorSpace)},getPrimaries:function(i){return this.spaces[i].primaries},getTransfer:function(i){return i===yi?dr:this.spaces[i].transfer},getToneMappingMode:function(i){return this.spaces[i].outputColorSpaceConfig.toneMappingMode||"standard"},getLuminanceCoefficients:function(i,s=this.workingColorSpace){return i.fromArray(this.spaces[s].luminanceCoefficients)},define:function(i){Object.assign(this.spaces,i)},_getMatrix:function(i,s,r){return i.copy(this.spaces[s].toXYZ).multiply(this.spaces[r].fromXYZ)},_getDrawingBufferColorSpace:function(i){return this.spaces[i].outputColorSpaceConfig.drawingBufferColorSpace},_getUnpackColorSpace:function(i=this.workingColorSpace){return this.spaces[i].workingColorSpaceConfig.unpackColorSpace},fromWorkingColorSpace:function(i,s){return mr("THREE.ColorManagement: .fromWorkingColorSpace() has been renamed to .workingToColorSpace()."),l.workingToColorSpace(i,s)},toWorkingColorSpace:function(i,s){return mr("THREE.ColorManagement: .toWorkingColorSpace() has been renamed to .colorSpaceToWorking()."),l.colorSpaceToWorking(i,s)}},e=[.64,.33,.3,.6,.15,.06],t=[.2126,.7152,.0722],n=[.3127,.329];return l.define({[ze]:{primaries:e,whitePoint:n,transfer:dr,toXYZ:$o,fromXYZ:Qo,luminanceCoefficients:t,workingColorSpaceConfig:{unpackColorSpace:O},outputColorSpaceConfig:{drawingBufferColorSpace:O}},[O]:{primaries:e,whitePoint:n,transfer:$i,toXYZ:$o,fromXYZ:Qo,luminanceCoefficients:t,outputColorSpaceConfig:{drawingBufferColorSpace:O}}}),l}var re=zc();function yt(l){return l<.04045?l*.0773993808:Math.pow(l*.9478672986+.0521327014,2.4)}function bn(l){return l<.0031308?l*12.92:1.055*Math.pow(l,.41666)-.055}var fn,An=class{static getDataURL(e,t="image/png"){if(/^data:/i.test(e.src)||typeof HTMLCanvasElement>"u")return e.src;let n;if(e instanceof HTMLCanvasElement)n=e;else{fn===void 0&&(fn=ts("canvas")),fn.width=e.width,fn.height=e.height;let i=fn.getContext("2d");e instanceof ImageData?i.putImageData(e,0,0):i.drawImage(e,0,0,e.width,e.height),n=fn}return n.toDataURL(t)}static sRGBToLinear(e){if(typeof HTMLImageElement<"u"&&e instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&e instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&e instanceof ImageBitmap){let t=ts("canvas");t.width=e.width,t.height=e.height;let n=t.getContext("2d");n.drawImage(e,0,0,e.width,e.height);let i=n.getImageData(0,0,e.width,e.height),s=i.data;for(let r=0;r<s.length;r++)s[r]=yt(s[r]/255)*255;return n.putImageData(i,0,0),t}else if(e.data){let t=e.data.slice(0);for(let n=0;n<t.length;n++)t instanceof Uint8Array||t instanceof Uint8ClampedArray?t[n]=Math.floor(yt(t[n]/255)*255):t[n]=yt(t[n]);return{data:t,width:e.width,height:e.height}}else return console.warn("THREE.ImageUtils.sRGBToLinear(): Unsupported image type. No color space conversion applied."),e}},kc=0,En=class{constructor(e=null){this.isSource=!0,Object.defineProperty(this,"id",{value:kc++}),this.uuid=it(),this.data=e,this.dataReady=!0,this.version=0}getSize(e){let t=this.data;return typeof HTMLVideoElement<"u"&&t instanceof HTMLVideoElement?e.set(t.videoWidth,t.videoHeight,0):t instanceof VideoFrame?e.set(t.displayHeight,t.displayWidth,0):t!==null?e.set(t.width,t.height,t.depth||0):e.set(0,0,0),e}set needsUpdate(e){e===!0&&this.version++}toJSON(e){let t=e===void 0||typeof e=="string";if(!t&&e.images[this.uuid]!==void 0)return e.images[this.uuid];let n={uuid:this.uuid,url:""},i=this.data;if(i!==null){let s;if(Array.isArray(i)){s=[];for(let r=0,o=i.length;r<o;r++)i[r].isDataTexture?s.push(Us(i[r].image)):s.push(Us(i[r]))}else s=Us(i);n.url=s}return t||(e.images[this.uuid]=n),n}};function Us(l){return typeof HTMLImageElement<"u"&&l instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&l instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&l instanceof ImageBitmap?An.getDataURL(l):l.data?{data:Array.from(l.data),width:l.width,height:l.height,type:l.data.constructor.name}:(console.warn("THREE.Texture: Unable to serialize Texture."),{})}var Vc=0,Ns=new M,Ie=class l extends jt{constructor(e=l.DEFAULT_IMAGE,t=l.DEFAULT_MAPPING,n=Re,i=Re,s=nt,r=ht,o=xi,a=Ur,c=l.DEFAULT_ANISOTROPY,u=yi){super(),this.isTexture=!0,Object.defineProperty(this,"id",{value:Vc++}),this.uuid=it(),this.name="",this.source=new En(e),this.mipmaps=[],this.mapping=t,this.channel=0,this.wrapS=n,this.wrapT=i,this.magFilter=s,this.minFilter=r,this.anisotropy=c,this.format=o,this.internalFormat=null,this.type=a,this.offset=new Z(0,0),this.repeat=new Z(1,1),this.center=new Z(0,0),this.rotation=0,this.matrixAutoUpdate=!0,this.matrix=new k,this.generateMipmaps=!0,this.premultiplyAlpha=!1,this.flipY=!0,this.unpackAlignment=4,this.colorSpace=u,this.userData={},this.updateRanges=[],this.version=0,this.onUpdate=null,this.renderTarget=null,this.isRenderTargetTexture=!1,this.isArrayTexture=!!(e&&e.depth&&e.depth>1),this.pmremVersion=0}get width(){return this.source.getSize(Ns).x}get height(){return this.source.getSize(Ns).y}get depth(){return this.source.getSize(Ns).z}get image(){return this.source.data}set image(e=null){this.source.data=e}updateMatrix(){this.matrix.setUvTransform(this.offset.x,this.offset.y,this.repeat.x,this.repeat.y,this.rotation,this.center.x,this.center.y)}addUpdateRange(e,t){this.updateRanges.push({start:e,count:t})}clearUpdateRanges(){this.updateRanges.length=0}clone(){return new this.constructor().copy(this)}copy(e){return this.name=e.name,this.source=e.source,this.mipmaps=e.mipmaps.slice(0),this.mapping=e.mapping,this.channel=e.channel,this.wrapS=e.wrapS,this.wrapT=e.wrapT,this.magFilter=e.magFilter,this.minFilter=e.minFilter,this.anisotropy=e.anisotropy,this.format=e.format,this.internalFormat=e.internalFormat,this.type=e.type,this.offset.copy(e.offset),this.repeat.copy(e.repeat),this.center.copy(e.center),this.rotation=e.rotation,this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrix.copy(e.matrix),this.generateMipmaps=e.generateMipmaps,this.premultiplyAlpha=e.premultiplyAlpha,this.flipY=e.flipY,this.unpackAlignment=e.unpackAlignment,this.colorSpace=e.colorSpace,this.renderTarget=e.renderTarget,this.isRenderTargetTexture=e.isRenderTargetTexture,this.isArrayTexture=e.isArrayTexture,this.userData=JSON.parse(JSON.stringify(e.userData)),this.needsUpdate=!0,this}setValues(e){for(let t in e){let n=e[t];if(n===void 0){console.warn(`THREE.Texture.setValues(): parameter '${t}' has value of undefined.`);continue}let i=this[t];if(i===void 0){console.warn(`THREE.Texture.setValues(): property '${t}' does not exist.`);continue}i&&n&&i.isVector2&&n.isVector2||i&&n&&i.isVector3&&n.isVector3||i&&n&&i.isMatrix3&&n.isMatrix3?i.copy(n):this[t]=n}}toJSON(e){let t=e===void 0||typeof e=="string";if(!t&&e.textures[this.uuid]!==void 0)return e.textures[this.uuid];let n={metadata:{version:4.7,type:"Texture",generator:"Texture.toJSON"},uuid:this.uuid,name:this.name,image:this.source.toJSON(e).uuid,mapping:this.mapping,channel:this.channel,repeat:[this.repeat.x,this.repeat.y],offset:[this.offset.x,this.offset.y],center:[this.center.x,this.center.y],rotation:this.rotation,wrap:[this.wrapS,this.wrapT],format:this.format,internalFormat:this.internalFormat,type:this.type,colorSpace:this.colorSpace,minFilter:this.minFilter,magFilter:this.magFilter,anisotropy:this.anisotropy,flipY:this.flipY,generateMipmaps:this.generateMipmaps,premultiplyAlpha:this.premultiplyAlpha,unpackAlignment:this.unpackAlignment};return Object.keys(this.userData).length>0&&(n.userData=this.userData),t||(e.textures[this.uuid]=n),n}dispose(){this.dispatchEvent({type:"dispose"})}transformUv(e){if(this.mapping!==Lr)return e;if(e.applyMatrix3(this.matrix),e.x<0||e.x>1)switch(this.wrapS){case Ce:e.x=e.x-Math.floor(e.x);break;case Re:e.x=e.x<0?0:1;break;case Jt:Math.abs(Math.floor(e.x)%2)===1?e.x=Math.ceil(e.x)-e.x:e.x=e.x-Math.floor(e.x);break}if(e.y<0||e.y>1)switch(this.wrapT){case Ce:e.y=e.y-Math.floor(e.y);break;case Re:e.y=e.y<0?0:1;break;case Jt:Math.abs(Math.floor(e.y)%2)===1?e.y=Math.ceil(e.y)-e.y:e.y=e.y-Math.floor(e.y);break}return this.flipY&&(e.y=1-e.y),e}set needsUpdate(e){e===!0&&(this.version++,this.source.needsUpdate=!0)}set needsPMREMUpdate(e){e===!0&&this.pmremVersion++}};Ie.DEFAULT_IMAGE=null;Ie.DEFAULT_MAPPING=Lr;Ie.DEFAULT_ANISOTROPY=1;var he=class l{constructor(e=0,t=0,n=0,i=1){l.prototype.isVector4=!0,this.x=e,this.y=t,this.z=n,this.w=i}get width(){return this.z}set width(e){this.z=e}get height(){return this.w}set height(e){this.w=e}set(e,t,n,i){return this.x=e,this.y=t,this.z=n,this.w=i,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this.w=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setW(e){return this.w=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;case 2:this.z=t;break;case 3:this.w=t;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;case 3:return this.w;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z,this.w)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this.w=e.w!==void 0?e.w:1,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this.w+=e.w,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this.w+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this.z=e.z+t.z,this.w=e.w+t.w,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this.z+=e.z*t,this.w+=e.w*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this.w-=e.w,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this.w-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this.z=e.z-t.z,this.w=e.w-t.w,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this.w*=e.w,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this.w*=e,this}applyMatrix4(e){let t=this.x,n=this.y,i=this.z,s=this.w,r=e.elements;return this.x=r[0]*t+r[4]*n+r[8]*i+r[12]*s,this.y=r[1]*t+r[5]*n+r[9]*i+r[13]*s,this.z=r[2]*t+r[6]*n+r[10]*i+r[14]*s,this.w=r[3]*t+r[7]*n+r[11]*i+r[15]*s,this}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this.w/=e.w,this}divideScalar(e){return this.multiplyScalar(1/e)}setAxisAngleFromQuaternion(e){this.w=2*Math.acos(e.w);let t=Math.sqrt(1-e.w*e.w);return t<1e-4?(this.x=1,this.y=0,this.z=0):(this.x=e.x/t,this.y=e.y/t,this.z=e.z/t),this}setAxisAngleFromRotationMatrix(e){let t,n,i,s,a=e.elements,c=a[0],u=a[4],h=a[8],f=a[1],d=a[5],p=a[9],g=a[2],m=a[6],x=a[10];if(Math.abs(u-f)<.01&&Math.abs(h-g)<.01&&Math.abs(p-m)<.01){if(Math.abs(u+f)<.1&&Math.abs(h+g)<.1&&Math.abs(p+m)<.1&&Math.abs(c+d+x-3)<.1)return this.set(1,0,0,0),this;t=Math.PI;let y=(c+1)/2,_=(d+1)/2,S=(x+1)/2,T=(u+f)/4,b=(h+g)/4,w=(p+m)/4;return y>_&&y>S?y<.01?(n=0,i=.707106781,s=.707106781):(n=Math.sqrt(y),i=T/n,s=b/n):_>S?_<.01?(n=.707106781,i=0,s=.707106781):(i=Math.sqrt(_),n=T/i,s=w/i):S<.01?(n=.707106781,i=.707106781,s=0):(s=Math.sqrt(S),n=b/s,i=w/s),this.set(n,i,s,t),this}let v=Math.sqrt((m-p)*(m-p)+(h-g)*(h-g)+(f-u)*(f-u));return Math.abs(v)<.001&&(v=1),this.x=(m-p)/v,this.y=(h-g)/v,this.z=(f-u)/v,this.w=Math.acos((c+d+x-1)/2),this}setFromMatrixPosition(e){let t=e.elements;return this.x=t[12],this.y=t[13],this.z=t[14],this.w=t[15],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this.w=Math.min(this.w,e.w),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this.w=Math.max(this.w,e.w),this}clamp(e,t){return this.x=G(this.x,e.x,t.x),this.y=G(this.y,e.y,t.y),this.z=G(this.z,e.z,t.z),this.w=G(this.w,e.w,t.w),this}clampScalar(e,t){return this.x=G(this.x,e,t),this.y=G(this.y,e,t),this.z=G(this.z,e,t),this.w=G(this.w,e,t),this}clampLength(e,t){let n=this.length();return this.divideScalar(n||1).multiplyScalar(G(n,e,t))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this.w=Math.floor(this.w),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this.w=Math.ceil(this.w),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this.w=Math.round(this.w),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this.w=Math.trunc(this.w),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this.w=-this.w,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z+this.w*e.w}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)+Math.abs(this.w)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this.z+=(e.z-this.z)*t,this.w+=(e.w-this.w)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this.z=e.z+(t.z-e.z)*n,this.w=e.w+(t.w-e.w)*n,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z&&e.w===this.w}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this.z=e[t+2],this.w=e[t+3],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e[t+2]=this.z,e[t+3]=this.w,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this.z=e.getZ(t),this.w=e.getW(t),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this.w=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z,yield this.w}};var ke=class{constructor(e=new M(1/0,1/0,1/0),t=new M(-1/0,-1/0,-1/0)){this.isBox3=!0,this.min=e,this.max=t}set(e,t){return this.min.copy(e),this.max.copy(t),this}setFromArray(e){this.makeEmpty();for(let t=0,n=e.length;t<n;t+=3)this.expandByPoint($e.fromArray(e,t));return this}setFromBufferAttribute(e){this.makeEmpty();for(let t=0,n=e.count;t<n;t++)this.expandByPoint($e.fromBufferAttribute(e,t));return this}setFromPoints(e){this.makeEmpty();for(let t=0,n=e.length;t<n;t++)this.expandByPoint(e[t]);return this}setFromCenterAndSize(e,t){let n=$e.copy(t).multiplyScalar(.5);return this.min.copy(e).sub(n),this.max.copy(e).add(n),this}setFromObject(e,t=!1){return this.makeEmpty(),this.expandByObject(e,t)}clone(){return new this.constructor().copy(this)}copy(e){return this.min.copy(e.min),this.max.copy(e.max),this}makeEmpty(){return this.min.x=this.min.y=this.min.z=1/0,this.max.x=this.max.y=this.max.z=-1/0,this}isEmpty(){return this.max.x<this.min.x||this.max.y<this.min.y||this.max.z<this.min.z}getCenter(e){return this.isEmpty()?e.set(0,0,0):e.addVectors(this.min,this.max).multiplyScalar(.5)}getSize(e){return this.isEmpty()?e.set(0,0,0):e.subVectors(this.max,this.min)}expandByPoint(e){return this.min.min(e),this.max.max(e),this}expandByVector(e){return this.min.sub(e),this.max.add(e),this}expandByScalar(e){return this.min.addScalar(-e),this.max.addScalar(e),this}expandByObject(e,t=!1){e.updateWorldMatrix(!1,!1);let n=e.geometry;if(n!==void 0){let s=n.getAttribute("position");if(t===!0&&s!==void 0&&e.isInstancedMesh!==!0)for(let r=0,o=s.count;r<o;r++)e.isMesh===!0?e.getVertexPosition(r,$e):$e.fromBufferAttribute(s,r),$e.applyMatrix4(e.matrixWorld),this.expandByPoint($e);else e.boundingBox!==void 0?(e.boundingBox===null&&e.computeBoundingBox(),wi.copy(e.boundingBox)):(n.boundingBox===null&&n.computeBoundingBox(),wi.copy(n.boundingBox)),wi.applyMatrix4(e.matrixWorld),this.union(wi)}let i=e.children;for(let s=0,r=i.length;s<r;s++)this.expandByObject(i[s],t);return this}containsPoint(e){return e.x>=this.min.x&&e.x<=this.max.x&&e.y>=this.min.y&&e.y<=this.max.y&&e.z>=this.min.z&&e.z<=this.max.z}containsBox(e){return this.min.x<=e.min.x&&e.max.x<=this.max.x&&this.min.y<=e.min.y&&e.max.y<=this.max.y&&this.min.z<=e.min.z&&e.max.z<=this.max.z}getParameter(e,t){return t.set((e.x-this.min.x)/(this.max.x-this.min.x),(e.y-this.min.y)/(this.max.y-this.min.y),(e.z-this.min.z)/(this.max.z-this.min.z))}intersectsBox(e){return e.max.x>=this.min.x&&e.min.x<=this.max.x&&e.max.y>=this.min.y&&e.min.y<=this.max.y&&e.max.z>=this.min.z&&e.min.z<=this.max.z}intersectsSphere(e){return this.clampPoint(e.center,$e),$e.distanceToSquared(e.center)<=e.radius*e.radius}intersectsPlane(e){let t,n;return e.normal.x>0?(t=e.normal.x*this.min.x,n=e.normal.x*this.max.x):(t=e.normal.x*this.max.x,n=e.normal.x*this.min.x),e.normal.y>0?(t+=e.normal.y*this.min.y,n+=e.normal.y*this.max.y):(t+=e.normal.y*this.max.y,n+=e.normal.y*this.min.y),e.normal.z>0?(t+=e.normal.z*this.min.z,n+=e.normal.z*this.max.z):(t+=e.normal.z*this.max.z,n+=e.normal.z*this.min.z),t<=-e.constant&&n>=-e.constant}intersectsTriangle(e){if(this.isEmpty())return!1;this.getCenter(Vn),Ai.subVectors(this.max,Vn),dn.subVectors(e.a,Vn),pn.subVectors(e.b,Vn),mn.subVectors(e.c,Vn),Pt.subVectors(pn,dn),Lt.subVectors(mn,pn),Xt.subVectors(dn,mn);let t=[0,-Pt.z,Pt.y,0,-Lt.z,Lt.y,0,-Xt.z,Xt.y,Pt.z,0,-Pt.x,Lt.z,0,-Lt.x,Xt.z,0,-Xt.x,-Pt.y,Pt.x,0,-Lt.y,Lt.x,0,-Xt.y,Xt.x,0];return!Fs(t,dn,pn,mn,Ai)||(t=[1,0,0,0,1,0,0,0,1],!Fs(t,dn,pn,mn,Ai))?!1:(Ei.crossVectors(Pt,Lt),t=[Ei.x,Ei.y,Ei.z],Fs(t,dn,pn,mn,Ai))}clampPoint(e,t){return t.copy(e).clamp(this.min,this.max)}distanceToPoint(e){return this.clampPoint(e,$e).distanceTo(e)}getBoundingSphere(e){return this.isEmpty()?e.makeEmpty():(this.getCenter(e.center),e.radius=this.getSize($e).length()*.5),e}intersect(e){return this.min.max(e.min),this.max.min(e.max),this.isEmpty()&&this.makeEmpty(),this}union(e){return this.min.min(e.min),this.max.max(e.max),this}applyMatrix4(e){return this.isEmpty()?this:(ft[0].set(this.min.x,this.min.y,this.min.z).applyMatrix4(e),ft[1].set(this.min.x,this.min.y,this.max.z).applyMatrix4(e),ft[2].set(this.min.x,this.max.y,this.min.z).applyMatrix4(e),ft[3].set(this.min.x,this.max.y,this.max.z).applyMatrix4(e),ft[4].set(this.max.x,this.min.y,this.min.z).applyMatrix4(e),ft[5].set(this.max.x,this.min.y,this.max.z).applyMatrix4(e),ft[6].set(this.max.x,this.max.y,this.min.z).applyMatrix4(e),ft[7].set(this.max.x,this.max.y,this.max.z).applyMatrix4(e),this.setFromPoints(ft),this)}translate(e){return this.min.add(e),this.max.add(e),this}equals(e){return e.min.equals(this.min)&&e.max.equals(this.max)}toJSON(){return{min:this.min.toArray(),max:this.max.toArray()}}fromJSON(e){return this.min.fromArray(e.min),this.max.fromArray(e.max),this}},ft=[new M,new M,new M,new M,new M,new M,new M,new M],$e=new M,wi=new ke,dn=new M,pn=new M,mn=new M,Pt=new M,Lt=new M,Xt=new M,Vn=new M,Ai=new M,Ei=new M,qt=new M;function Fs(l,e,t,n,i){for(let s=0,r=l.length-3;s<=r;s+=3){qt.fromArray(l,s);let o=i.x*Math.abs(qt.x)+i.y*Math.abs(qt.y)+i.z*Math.abs(qt.z),a=e.dot(qt),c=t.dot(qt),u=n.dot(qt);if(Math.max(-Math.max(a,c,u),Math.min(a,c,u))>o)return!1}return!0}var Hc=new ke,Hn=new M,Os=new M,Pe=class{constructor(e=new M,t=-1){this.isSphere=!0,this.center=e,this.radius=t}set(e,t){return this.center.copy(e),this.radius=t,this}setFromPoints(e,t){let n=this.center;t!==void 0?n.copy(t):Hc.setFromPoints(e).getCenter(n);let i=0;for(let s=0,r=e.length;s<r;s++)i=Math.max(i,n.distanceToSquared(e[s]));return this.radius=Math.sqrt(i),this}copy(e){return this.center.copy(e.center),this.radius=e.radius,this}isEmpty(){return this.radius<0}makeEmpty(){return this.center.set(0,0,0),this.radius=-1,this}containsPoint(e){return e.distanceToSquared(this.center)<=this.radius*this.radius}distanceToPoint(e){return e.distanceTo(this.center)-this.radius}intersectsSphere(e){let t=this.radius+e.radius;return e.center.distanceToSquared(this.center)<=t*t}intersectsBox(e){return e.intersectsSphere(this)}intersectsPlane(e){return Math.abs(e.distanceToPoint(this.center))<=this.radius}clampPoint(e,t){let n=this.center.distanceToSquared(e);return t.copy(e),n>this.radius*this.radius&&(t.sub(this.center).normalize(),t.multiplyScalar(this.radius).add(this.center)),t}getBoundingBox(e){return this.isEmpty()?(e.makeEmpty(),e):(e.set(this.center,this.center),e.expandByScalar(this.radius),e)}applyMatrix4(e){return this.center.applyMatrix4(e),this.radius=this.radius*e.getMaxScaleOnAxis(),this}translate(e){return this.center.add(e),this}expandByPoint(e){if(this.isEmpty())return this.center.copy(e),this.radius=0,this;Hn.subVectors(e,this.center);let t=Hn.lengthSq();if(t>this.radius*this.radius){let n=Math.sqrt(t),i=(n-this.radius)*.5;this.center.addScaledVector(Hn,i/n),this.radius+=i}return this}union(e){return e.isEmpty()?this:this.isEmpty()?(this.copy(e),this):(this.center.equals(e.center)===!0?this.radius=Math.max(this.radius,e.radius):(Os.subVectors(e.center,this.center).setLength(e.radius),this.expandByPoint(Hn.copy(e.center).add(Os)),this.expandByPoint(Hn.copy(e.center).sub(Os))),this)}equals(e){return e.center.equals(this.center)&&e.radius===this.radius}clone(){return new this.constructor().copy(this)}toJSON(){return{radius:this.radius,center:this.center.toArray()}}fromJSON(e){return this.radius=e.radius,this.center.fromArray(e.center),this}},dt=new M,Bs=new M,Ri=new M,Dt=new M,zs=new M,Ci=new M,ks=new M,$t=class{constructor(e=new M,t=new M(0,0,-1)){this.origin=e,this.direction=t}set(e,t){return this.origin.copy(e),this.direction.copy(t),this}copy(e){return this.origin.copy(e.origin),this.direction.copy(e.direction),this}at(e,t){return t.copy(this.origin).addScaledVector(this.direction,e)}lookAt(e){return this.direction.copy(e).sub(this.origin).normalize(),this}recast(e){return this.origin.copy(this.at(e,dt)),this}closestPointToPoint(e,t){t.subVectors(e,this.origin);let n=t.dot(this.direction);return n<0?t.copy(this.origin):t.copy(this.origin).addScaledVector(this.direction,n)}distanceToPoint(e){return Math.sqrt(this.distanceSqToPoint(e))}distanceSqToPoint(e){let t=dt.subVectors(e,this.origin).dot(this.direction);return t<0?this.origin.distanceToSquared(e):(dt.copy(this.origin).addScaledVector(this.direction,t),dt.distanceToSquared(e))}distanceSqToSegment(e,t,n,i){Bs.copy(e).add(t).multiplyScalar(.5),Ri.copy(t).sub(e).normalize(),Dt.copy(this.origin).sub(Bs);let s=e.distanceTo(t)*.5,r=-this.direction.dot(Ri),o=Dt.dot(this.direction),a=-Dt.dot(Ri),c=Dt.lengthSq(),u=Math.abs(1-r*r),h,f,d,p;if(u>0)if(h=r*a-o,f=r*o-a,p=s*u,h>=0)if(f>=-p)if(f<=p){let g=1/u;h*=g,f*=g,d=h*(h+r*f+2*o)+f*(r*h+f+2*a)+c}else f=s,h=Math.max(0,-(r*f+o)),d=-h*h+f*(f+2*a)+c;else f=-s,h=Math.max(0,-(r*f+o)),d=-h*h+f*(f+2*a)+c;else f<=-p?(h=Math.max(0,-(-r*s+o)),f=h>0?-s:Math.min(Math.max(-s,-a),s),d=-h*h+f*(f+2*a)+c):f<=p?(h=0,f=Math.min(Math.max(-s,-a),s),d=f*(f+2*a)+c):(h=Math.max(0,-(r*s+o)),f=h>0?s:Math.min(Math.max(-s,-a),s),d=-h*h+f*(f+2*a)+c);else f=r>0?-s:s,h=Math.max(0,-(r*f+o)),d=-h*h+f*(f+2*a)+c;return n&&n.copy(this.origin).addScaledVector(this.direction,h),i&&i.copy(Bs).addScaledVector(Ri,f),d}intersectSphere(e,t){dt.subVectors(e.center,this.origin);let n=dt.dot(this.direction),i=dt.dot(dt)-n*n,s=e.radius*e.radius;if(i>s)return null;let r=Math.sqrt(s-i),o=n-r,a=n+r;return a<0?null:o<0?this.at(a,t):this.at(o,t)}intersectsSphere(e){return e.radius<0?!1:this.distanceSqToPoint(e.center)<=e.radius*e.radius}distanceToPlane(e){let t=e.normal.dot(this.direction);if(t===0)return e.distanceToPoint(this.origin)===0?0:null;let n=-(this.origin.dot(e.normal)+e.constant)/t;return n>=0?n:null}intersectPlane(e,t){let n=this.distanceToPlane(e);return n===null?null:this.at(n,t)}intersectsPlane(e){let t=e.distanceToPoint(this.origin);return t===0||e.normal.dot(this.direction)*t<0}intersectBox(e,t){let n,i,s,r,o,a,c=1/this.direction.x,u=1/this.direction.y,h=1/this.direction.z,f=this.origin;return c>=0?(n=(e.min.x-f.x)*c,i=(e.max.x-f.x)*c):(n=(e.max.x-f.x)*c,i=(e.min.x-f.x)*c),u>=0?(s=(e.min.y-f.y)*u,r=(e.max.y-f.y)*u):(s=(e.max.y-f.y)*u,r=(e.min.y-f.y)*u),n>r||s>i||((s>n||isNaN(n))&&(n=s),(r<i||isNaN(i))&&(i=r),h>=0?(o=(e.min.z-f.z)*h,a=(e.max.z-f.z)*h):(o=(e.max.z-f.z)*h,a=(e.min.z-f.z)*h),n>a||o>i)||((o>n||n!==n)&&(n=o),(a<i||i!==i)&&(i=a),i<0)?null:this.at(n>=0?n:i,t)}intersectsBox(e){return this.intersectBox(e,dt)!==null}intersectTriangle(e,t,n,i,s){zs.subVectors(t,e),Ci.subVectors(n,e),ks.crossVectors(zs,Ci);let r=this.direction.dot(ks),o;if(r>0){if(i)return null;o=1}else if(r<0)o=-1,r=-r;else return null;Dt.subVectors(this.origin,e);let a=o*this.direction.dot(Ci.crossVectors(Dt,Ci));if(a<0)return null;let c=o*this.direction.dot(zs.cross(Dt));if(c<0||a+c>r)return null;let u=-o*Dt.dot(ks);return u<0?null:this.at(u/r,s)}applyMatrix4(e){return this.origin.applyMatrix4(e),this.direction.transformDirection(e),this}equals(e){return e.origin.equals(this.origin)&&e.direction.equals(this.direction)}clone(){return new this.constructor().copy(this)}},D=class l{constructor(e,t,n,i,s,r,o,a,c,u,h,f,d,p,g,m){l.prototype.isMatrix4=!0,this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],e!==void 0&&this.set(e,t,n,i,s,r,o,a,c,u,h,f,d,p,g,m)}set(e,t,n,i,s,r,o,a,c,u,h,f,d,p,g,m){let x=this.elements;return x[0]=e,x[4]=t,x[8]=n,x[12]=i,x[1]=s,x[5]=r,x[9]=o,x[13]=a,x[2]=c,x[6]=u,x[10]=h,x[14]=f,x[3]=d,x[7]=p,x[11]=g,x[15]=m,this}identity(){return this.set(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1),this}clone(){return new l().fromArray(this.elements)}copy(e){let t=this.elements,n=e.elements;return t[0]=n[0],t[1]=n[1],t[2]=n[2],t[3]=n[3],t[4]=n[4],t[5]=n[5],t[6]=n[6],t[7]=n[7],t[8]=n[8],t[9]=n[9],t[10]=n[10],t[11]=n[11],t[12]=n[12],t[13]=n[13],t[14]=n[14],t[15]=n[15],this}copyPosition(e){let t=this.elements,n=e.elements;return t[12]=n[12],t[13]=n[13],t[14]=n[14],this}setFromMatrix3(e){let t=e.elements;return this.set(t[0],t[3],t[6],0,t[1],t[4],t[7],0,t[2],t[5],t[8],0,0,0,0,1),this}extractBasis(e,t,n){return e.setFromMatrixColumn(this,0),t.setFromMatrixColumn(this,1),n.setFromMatrixColumn(this,2),this}makeBasis(e,t,n){return this.set(e.x,t.x,n.x,0,e.y,t.y,n.y,0,e.z,t.z,n.z,0,0,0,0,1),this}extractRotation(e){let t=this.elements,n=e.elements,i=1/gn.setFromMatrixColumn(e,0).length(),s=1/gn.setFromMatrixColumn(e,1).length(),r=1/gn.setFromMatrixColumn(e,2).length();return t[0]=n[0]*i,t[1]=n[1]*i,t[2]=n[2]*i,t[3]=0,t[4]=n[4]*s,t[5]=n[5]*s,t[6]=n[6]*s,t[7]=0,t[8]=n[8]*r,t[9]=n[9]*r,t[10]=n[10]*r,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,this}makeRotationFromEuler(e){let t=this.elements,n=e.x,i=e.y,s=e.z,r=Math.cos(n),o=Math.sin(n),a=Math.cos(i),c=Math.sin(i),u=Math.cos(s),h=Math.sin(s);if(e.order==="XYZ"){let f=r*u,d=r*h,p=o*u,g=o*h;t[0]=a*u,t[4]=-a*h,t[8]=c,t[1]=d+p*c,t[5]=f-g*c,t[9]=-o*a,t[2]=g-f*c,t[6]=p+d*c,t[10]=r*a}else if(e.order==="YXZ"){let f=a*u,d=a*h,p=c*u,g=c*h;t[0]=f+g*o,t[4]=p*o-d,t[8]=r*c,t[1]=r*h,t[5]=r*u,t[9]=-o,t[2]=d*o-p,t[6]=g+f*o,t[10]=r*a}else if(e.order==="ZXY"){let f=a*u,d=a*h,p=c*u,g=c*h;t[0]=f-g*o,t[4]=-r*h,t[8]=p+d*o,t[1]=d+p*o,t[5]=r*u,t[9]=g-f*o,t[2]=-r*c,t[6]=o,t[10]=r*a}else if(e.order==="ZYX"){let f=r*u,d=r*h,p=o*u,g=o*h;t[0]=a*u,t[4]=p*c-d,t[8]=f*c+g,t[1]=a*h,t[5]=g*c+f,t[9]=d*c-p,t[2]=-c,t[6]=o*a,t[10]=r*a}else if(e.order==="YZX"){let f=r*a,d=r*c,p=o*a,g=o*c;t[0]=a*u,t[4]=g-f*h,t[8]=p*h+d,t[1]=h,t[5]=r*u,t[9]=-o*u,t[2]=-c*u,t[6]=d*h+p,t[10]=f-g*h}else if(e.order==="XZY"){let f=r*a,d=r*c,p=o*a,g=o*c;t[0]=a*u,t[4]=-h,t[8]=c*u,t[1]=f*h+g,t[5]=r*u,t[9]=d*h-p,t[2]=p*h-d,t[6]=o*u,t[10]=g*h+f}return t[3]=0,t[7]=0,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,this}makeRotationFromQuaternion(e){return this.compose(Gc,e,Wc)}lookAt(e,t,n){let i=this.elements;return Oe.subVectors(e,t),Oe.lengthSq()===0&&(Oe.z=1),Oe.normalize(),Ut.crossVectors(n,Oe),Ut.lengthSq()===0&&(Math.abs(n.z)===1?Oe.x+=1e-4:Oe.z+=1e-4,Oe.normalize(),Ut.crossVectors(n,Oe)),Ut.normalize(),Ii.crossVectors(Oe,Ut),i[0]=Ut.x,i[4]=Ii.x,i[8]=Oe.x,i[1]=Ut.y,i[5]=Ii.y,i[9]=Oe.y,i[2]=Ut.z,i[6]=Ii.z,i[10]=Oe.z,this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,t){let n=e.elements,i=t.elements,s=this.elements,r=n[0],o=n[4],a=n[8],c=n[12],u=n[1],h=n[5],f=n[9],d=n[13],p=n[2],g=n[6],m=n[10],x=n[14],v=n[3],y=n[7],_=n[11],S=n[15],T=i[0],b=i[4],w=i[8],E=i[12],C=i[1],A=i[5],K=i[9],$=i[13],le=i[2],te=i[6],R=i[10],V=i[14],z=i[3],H=i[7],ae=i[11],j=i[15];return s[0]=r*T+o*C+a*le+c*z,s[4]=r*b+o*A+a*te+c*H,s[8]=r*w+o*K+a*R+c*ae,s[12]=r*E+o*$+a*V+c*j,s[1]=u*T+h*C+f*le+d*z,s[5]=u*b+h*A+f*te+d*H,s[9]=u*w+h*K+f*R+d*ae,s[13]=u*E+h*$+f*V+d*j,s[2]=p*T+g*C+m*le+x*z,s[6]=p*b+g*A+m*te+x*H,s[10]=p*w+g*K+m*R+x*ae,s[14]=p*E+g*$+m*V+x*j,s[3]=v*T+y*C+_*le+S*z,s[7]=v*b+y*A+_*te+S*H,s[11]=v*w+y*K+_*R+S*ae,s[15]=v*E+y*$+_*V+S*j,this}multiplyScalar(e){let t=this.elements;return t[0]*=e,t[4]*=e,t[8]*=e,t[12]*=e,t[1]*=e,t[5]*=e,t[9]*=e,t[13]*=e,t[2]*=e,t[6]*=e,t[10]*=e,t[14]*=e,t[3]*=e,t[7]*=e,t[11]*=e,t[15]*=e,this}determinant(){let e=this.elements,t=e[0],n=e[4],i=e[8],s=e[12],r=e[1],o=e[5],a=e[9],c=e[13],u=e[2],h=e[6],f=e[10],d=e[14],p=e[3],g=e[7],m=e[11],x=e[15];return p*(+s*a*h-i*c*h-s*o*f+n*c*f+i*o*d-n*a*d)+g*(+t*a*d-t*c*f+s*r*f-i*r*d+i*c*u-s*a*u)+m*(+t*c*h-t*o*d-s*r*h+n*r*d+s*o*u-n*c*u)+x*(-i*o*u-t*a*h+t*o*f+i*r*h-n*r*f+n*a*u)}transpose(){let e=this.elements,t;return t=e[1],e[1]=e[4],e[4]=t,t=e[2],e[2]=e[8],e[8]=t,t=e[6],e[6]=e[9],e[9]=t,t=e[3],e[3]=e[12],e[12]=t,t=e[7],e[7]=e[13],e[13]=t,t=e[11],e[11]=e[14],e[14]=t,this}setPosition(e,t,n){let i=this.elements;return e.isVector3?(i[12]=e.x,i[13]=e.y,i[14]=e.z):(i[12]=e,i[13]=t,i[14]=n),this}invert(){let e=this.elements,t=e[0],n=e[1],i=e[2],s=e[3],r=e[4],o=e[5],a=e[6],c=e[7],u=e[8],h=e[9],f=e[10],d=e[11],p=e[12],g=e[13],m=e[14],x=e[15],v=h*m*c-g*f*c+g*a*d-o*m*d-h*a*x+o*f*x,y=p*f*c-u*m*c-p*a*d+r*m*d+u*a*x-r*f*x,_=u*g*c-p*h*c+p*o*d-r*g*d-u*o*x+r*h*x,S=p*h*a-u*g*a-p*o*f+r*g*f+u*o*m-r*h*m,T=t*v+n*y+i*_+s*S;if(T===0)return this.set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0);let b=1/T;return e[0]=v*b,e[1]=(g*f*s-h*m*s-g*i*d+n*m*d+h*i*x-n*f*x)*b,e[2]=(o*m*s-g*a*s+g*i*c-n*m*c-o*i*x+n*a*x)*b,e[3]=(h*a*s-o*f*s-h*i*c+n*f*c+o*i*d-n*a*d)*b,e[4]=y*b,e[5]=(u*m*s-p*f*s+p*i*d-t*m*d-u*i*x+t*f*x)*b,e[6]=(p*a*s-r*m*s-p*i*c+t*m*c+r*i*x-t*a*x)*b,e[7]=(r*f*s-u*a*s+u*i*c-t*f*c-r*i*d+t*a*d)*b,e[8]=_*b,e[9]=(p*h*s-u*g*s-p*n*d+t*g*d+u*n*x-t*h*x)*b,e[10]=(r*g*s-p*o*s+p*n*c-t*g*c-r*n*x+t*o*x)*b,e[11]=(u*o*s-r*h*s-u*n*c+t*h*c+r*n*d-t*o*d)*b,e[12]=S*b,e[13]=(u*g*i-p*h*i+p*n*f-t*g*f-u*n*m+t*h*m)*b,e[14]=(p*o*i-r*g*i-p*n*a+t*g*a+r*n*m-t*o*m)*b,e[15]=(r*h*i-u*o*i+u*n*a-t*h*a-r*n*f+t*o*f)*b,this}scale(e){let t=this.elements,n=e.x,i=e.y,s=e.z;return t[0]*=n,t[4]*=i,t[8]*=s,t[1]*=n,t[5]*=i,t[9]*=s,t[2]*=n,t[6]*=i,t[10]*=s,t[3]*=n,t[7]*=i,t[11]*=s,this}getMaxScaleOnAxis(){let e=this.elements,t=e[0]*e[0]+e[1]*e[1]+e[2]*e[2],n=e[4]*e[4]+e[5]*e[5]+e[6]*e[6],i=e[8]*e[8]+e[9]*e[9]+e[10]*e[10];return Math.sqrt(Math.max(t,n,i))}makeTranslation(e,t,n){return e.isVector3?this.set(1,0,0,e.x,0,1,0,e.y,0,0,1,e.z,0,0,0,1):this.set(1,0,0,e,0,1,0,t,0,0,1,n,0,0,0,1),this}makeRotationX(e){let t=Math.cos(e),n=Math.sin(e);return this.set(1,0,0,0,0,t,-n,0,0,n,t,0,0,0,0,1),this}makeRotationY(e){let t=Math.cos(e),n=Math.sin(e);return this.set(t,0,n,0,0,1,0,0,-n,0,t,0,0,0,0,1),this}makeRotationZ(e){let t=Math.cos(e),n=Math.sin(e);return this.set(t,-n,0,0,n,t,0,0,0,0,1,0,0,0,0,1),this}makeRotationAxis(e,t){let n=Math.cos(t),i=Math.sin(t),s=1-n,r=e.x,o=e.y,a=e.z,c=s*r,u=s*o;return this.set(c*r+n,c*o-i*a,c*a+i*o,0,c*o+i*a,u*o+n,u*a-i*r,0,c*a-i*o,u*a+i*r,s*a*a+n,0,0,0,0,1),this}makeScale(e,t,n){return this.set(e,0,0,0,0,t,0,0,0,0,n,0,0,0,0,1),this}makeShear(e,t,n,i,s,r){return this.set(1,n,s,0,e,1,r,0,t,i,1,0,0,0,0,1),this}compose(e,t,n){let i=this.elements,s=t._x,r=t._y,o=t._z,a=t._w,c=s+s,u=r+r,h=o+o,f=s*c,d=s*u,p=s*h,g=r*u,m=r*h,x=o*h,v=a*c,y=a*u,_=a*h,S=n.x,T=n.y,b=n.z;return i[0]=(1-(g+x))*S,i[1]=(d+_)*S,i[2]=(p-y)*S,i[3]=0,i[4]=(d-_)*T,i[5]=(1-(f+x))*T,i[6]=(m+v)*T,i[7]=0,i[8]=(p+y)*b,i[9]=(m-v)*b,i[10]=(1-(f+g))*b,i[11]=0,i[12]=e.x,i[13]=e.y,i[14]=e.z,i[15]=1,this}decompose(e,t,n){let i=this.elements,s=gn.set(i[0],i[1],i[2]).length(),r=gn.set(i[4],i[5],i[6]).length(),o=gn.set(i[8],i[9],i[10]).length();this.determinant()<0&&(s=-s),e.x=i[12],e.y=i[13],e.z=i[14],Qe.copy(this);let c=1/s,u=1/r,h=1/o;return Qe.elements[0]*=c,Qe.elements[1]*=c,Qe.elements[2]*=c,Qe.elements[4]*=u,Qe.elements[5]*=u,Qe.elements[6]*=u,Qe.elements[8]*=h,Qe.elements[9]*=h,Qe.elements[10]*=h,t.setFromRotationMatrix(Qe),n.x=s,n.y=r,n.z=o,this}makePerspective(e,t,n,i,s,r,o=Bt,a=!1){let c=this.elements,u=2*s/(t-e),h=2*s/(n-i),f=(t+e)/(t-e),d=(n+i)/(n-i),p,g;if(a)p=s/(r-s),g=r*s/(r-s);else if(o===Bt)p=-(r+s)/(r-s),g=-2*r*s/(r-s);else if(o===es)p=-r/(r-s),g=-r*s/(r-s);else throw new Error("THREE.Matrix4.makePerspective(): Invalid coordinate system: "+o);return c[0]=u,c[4]=0,c[8]=f,c[12]=0,c[1]=0,c[5]=h,c[9]=d,c[13]=0,c[2]=0,c[6]=0,c[10]=p,c[14]=g,c[3]=0,c[7]=0,c[11]=-1,c[15]=0,this}makeOrthographic(e,t,n,i,s,r,o=Bt,a=!1){let c=this.elements,u=2/(t-e),h=2/(n-i),f=-(t+e)/(t-e),d=-(n+i)/(n-i),p,g;if(a)p=1/(r-s),g=r/(r-s);else if(o===Bt)p=-2/(r-s),g=-(r+s)/(r-s);else if(o===es)p=-1/(r-s),g=-s/(r-s);else throw new Error("THREE.Matrix4.makeOrthographic(): Invalid coordinate system: "+o);return c[0]=u,c[4]=0,c[8]=0,c[12]=f,c[1]=0,c[5]=h,c[9]=0,c[13]=d,c[2]=0,c[6]=0,c[10]=p,c[14]=g,c[3]=0,c[7]=0,c[11]=0,c[15]=1,this}equals(e){let t=this.elements,n=e.elements;for(let i=0;i<16;i++)if(t[i]!==n[i])return!1;return!0}fromArray(e,t=0){for(let n=0;n<16;n++)this.elements[n]=e[n+t];return this}toArray(e=[],t=0){let n=this.elements;return e[t]=n[0],e[t+1]=n[1],e[t+2]=n[2],e[t+3]=n[3],e[t+4]=n[4],e[t+5]=n[5],e[t+6]=n[6],e[t+7]=n[7],e[t+8]=n[8],e[t+9]=n[9],e[t+10]=n[10],e[t+11]=n[11],e[t+12]=n[12],e[t+13]=n[13],e[t+14]=n[14],e[t+15]=n[15],e}},gn=new M,Qe=new D,Gc=new M(0,0,0),Wc=new M(1,1,1),Ut=new M,Ii=new M,Oe=new M,ea=new D,ta=new fe,_e=class l{constructor(e=0,t=0,n=0,i=l.DEFAULT_ORDER){this.isEuler=!0,this._x=e,this._y=t,this._z=n,this._order=i}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get order(){return this._order}set order(e){this._order=e,this._onChangeCallback()}set(e,t,n,i=this._order){return this._x=e,this._y=t,this._z=n,this._order=i,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._order)}copy(e){return this._x=e._x,this._y=e._y,this._z=e._z,this._order=e._order,this._onChangeCallback(),this}setFromRotationMatrix(e,t=this._order,n=!0){let i=e.elements,s=i[0],r=i[4],o=i[8],a=i[1],c=i[5],u=i[9],h=i[2],f=i[6],d=i[10];switch(t){case"XYZ":this._y=Math.asin(G(o,-1,1)),Math.abs(o)<.9999999?(this._x=Math.atan2(-u,d),this._z=Math.atan2(-r,s)):(this._x=Math.atan2(f,c),this._z=0);break;case"YXZ":this._x=Math.asin(-G(u,-1,1)),Math.abs(u)<.9999999?(this._y=Math.atan2(o,d),this._z=Math.atan2(a,c)):(this._y=Math.atan2(-h,s),this._z=0);break;case"ZXY":this._x=Math.asin(G(f,-1,1)),Math.abs(f)<.9999999?(this._y=Math.atan2(-h,d),this._z=Math.atan2(-r,c)):(this._y=0,this._z=Math.atan2(a,s));break;case"ZYX":this._y=Math.asin(-G(h,-1,1)),Math.abs(h)<.9999999?(this._x=Math.atan2(f,d),this._z=Math.atan2(a,s)):(this._x=0,this._z=Math.atan2(-r,c));break;case"YZX":this._z=Math.asin(G(a,-1,1)),Math.abs(a)<.9999999?(this._x=Math.atan2(-u,c),this._y=Math.atan2(-h,s)):(this._x=0,this._y=Math.atan2(o,d));break;case"XZY":this._z=Math.asin(-G(r,-1,1)),Math.abs(r)<.9999999?(this._x=Math.atan2(f,c),this._y=Math.atan2(o,s)):(this._x=Math.atan2(-u,d),this._y=0);break;default:console.warn("THREE.Euler: .setFromRotationMatrix() encountered an unknown order: "+t)}return this._order=t,n===!0&&this._onChangeCallback(),this}setFromQuaternion(e,t,n){return ea.makeRotationFromQuaternion(e),this.setFromRotationMatrix(ea,t,n)}setFromVector3(e,t=this._order){return this.set(e.x,e.y,e.z,t)}reorder(e){return ta.setFromEuler(this),this.setFromQuaternion(ta,e)}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._order===this._order}fromArray(e){return this._x=e[0],this._y=e[1],this._z=e[2],e[3]!==void 0&&(this._order=e[3]),this._onChangeCallback(),this}toArray(e=[],t=0){return e[t]=this._x,e[t+1]=this._y,e[t+2]=this._z,e[t+3]=this._order,e}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._order}};_e.DEFAULT_ORDER="XYZ";var ns=class{constructor(){this.mask=1}set(e){this.mask=(1<<e|0)>>>0}enable(e){this.mask|=1<<e|0}enableAll(){this.mask=-1}toggle(e){this.mask^=1<<e|0}disable(e){this.mask&=~(1<<e|0)}disableAll(){this.mask=0}test(e){return(this.mask&e.mask)!==0}isEnabled(e){return(this.mask&(1<<e|0))!==0}},Xc=0,na=new M,xn=new fe,pt=new D,Pi=new M,Gn=new M,qc=new M,Yc=new fe,ia=new M(1,0,0),sa=new M(0,1,0),ra=new M(0,0,1),oa={type:"added"},Kc={type:"removed"},_n={type:"childadded",child:null},Vs={type:"childremoved",child:null},oe=class l extends jt{constructor(){super(),this.isObject3D=!0,Object.defineProperty(this,"id",{value:Xc++}),this.uuid=it(),this.name="",this.type="Object3D",this.parent=null,this.children=[],this.up=l.DEFAULT_UP.clone();let e=new M,t=new _e,n=new fe,i=new M(1,1,1);function s(){n.setFromEuler(t,!1)}function r(){t.setFromQuaternion(n,void 0,!1)}t._onChange(s),n._onChange(r),Object.defineProperties(this,{position:{configurable:!0,enumerable:!0,value:e},rotation:{configurable:!0,enumerable:!0,value:t},quaternion:{configurable:!0,enumerable:!0,value:n},scale:{configurable:!0,enumerable:!0,value:i},modelViewMatrix:{value:new D},normalMatrix:{value:new k}}),this.matrix=new D,this.matrixWorld=new D,this.matrixAutoUpdate=l.DEFAULT_MATRIX_AUTO_UPDATE,this.matrixWorldAutoUpdate=l.DEFAULT_MATRIX_WORLD_AUTO_UPDATE,this.matrixWorldNeedsUpdate=!1,this.layers=new ns,this.visible=!0,this.castShadow=!1,this.receiveShadow=!1,this.frustumCulled=!0,this.renderOrder=0,this.animations=[],this.customDepthMaterial=void 0,this.customDistanceMaterial=void 0,this.userData={}}onBeforeShadow(){}onAfterShadow(){}onBeforeRender(){}onAfterRender(){}applyMatrix4(e){this.matrixAutoUpdate&&this.updateMatrix(),this.matrix.premultiply(e),this.matrix.decompose(this.position,this.quaternion,this.scale)}applyQuaternion(e){return this.quaternion.premultiply(e),this}setRotationFromAxisAngle(e,t){this.quaternion.setFromAxisAngle(e,t)}setRotationFromEuler(e){this.quaternion.setFromEuler(e,!0)}setRotationFromMatrix(e){this.quaternion.setFromRotationMatrix(e)}setRotationFromQuaternion(e){this.quaternion.copy(e)}rotateOnAxis(e,t){return xn.setFromAxisAngle(e,t),this.quaternion.multiply(xn),this}rotateOnWorldAxis(e,t){return xn.setFromAxisAngle(e,t),this.quaternion.premultiply(xn),this}rotateX(e){return this.rotateOnAxis(ia,e)}rotateY(e){return this.rotateOnAxis(sa,e)}rotateZ(e){return this.rotateOnAxis(ra,e)}translateOnAxis(e,t){return na.copy(e).applyQuaternion(this.quaternion),this.position.add(na.multiplyScalar(t)),this}translateX(e){return this.translateOnAxis(ia,e)}translateY(e){return this.translateOnAxis(sa,e)}translateZ(e){return this.translateOnAxis(ra,e)}localToWorld(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(this.matrixWorld)}worldToLocal(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(pt.copy(this.matrixWorld).invert())}lookAt(e,t,n){e.isVector3?Pi.copy(e):Pi.set(e,t,n);let i=this.parent;this.updateWorldMatrix(!0,!1),Gn.setFromMatrixPosition(this.matrixWorld),this.isCamera||this.isLight?pt.lookAt(Gn,Pi,this.up):pt.lookAt(Pi,Gn,this.up),this.quaternion.setFromRotationMatrix(pt),i&&(pt.extractRotation(i.matrixWorld),xn.setFromRotationMatrix(pt),this.quaternion.premultiply(xn.invert()))}add(e){if(arguments.length>1){for(let t=0;t<arguments.length;t++)this.add(arguments[t]);return this}return e===this?(console.error("THREE.Object3D.add: object can't be added as a child of itself.",e),this):(e&&e.isObject3D?(e.removeFromParent(),e.parent=this,this.children.push(e),e.dispatchEvent(oa),_n.child=e,this.dispatchEvent(_n),_n.child=null):console.error("THREE.Object3D.add: object not an instance of THREE.Object3D.",e),this)}remove(e){if(arguments.length>1){for(let n=0;n<arguments.length;n++)this.remove(arguments[n]);return this}let t=this.children.indexOf(e);return t!==-1&&(e.parent=null,this.children.splice(t,1),e.dispatchEvent(Kc),Vs.child=e,this.dispatchEvent(Vs),Vs.child=null),this}removeFromParent(){let e=this.parent;return e!==null&&e.remove(this),this}clear(){return this.remove(...this.children)}attach(e){return this.updateWorldMatrix(!0,!1),pt.copy(this.matrixWorld).invert(),e.parent!==null&&(e.parent.updateWorldMatrix(!0,!1),pt.multiply(e.parent.matrixWorld)),e.applyMatrix4(pt),e.removeFromParent(),e.parent=this,this.children.push(e),e.updateWorldMatrix(!1,!0),e.dispatchEvent(oa),_n.child=e,this.dispatchEvent(_n),_n.child=null,this}getObjectById(e){return this.getObjectByProperty("id",e)}getObjectByName(e){return this.getObjectByProperty("name",e)}getObjectByProperty(e,t){if(this[e]===t)return this;for(let n=0,i=this.children.length;n<i;n++){let r=this.children[n].getObjectByProperty(e,t);if(r!==void 0)return r}}getObjectsByProperty(e,t,n=[]){this[e]===t&&n.push(this);let i=this.children;for(let s=0,r=i.length;s<r;s++)i[s].getObjectsByProperty(e,t,n);return n}getWorldPosition(e){return this.updateWorldMatrix(!0,!1),e.setFromMatrixPosition(this.matrixWorld)}getWorldQuaternion(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(Gn,e,qc),e}getWorldScale(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(Gn,Yc,e),e}getWorldDirection(e){this.updateWorldMatrix(!0,!1);let t=this.matrixWorld.elements;return e.set(t[8],t[9],t[10]).normalize()}raycast(){}traverse(e){e(this);let t=this.children;for(let n=0,i=t.length;n<i;n++)t[n].traverse(e)}traverseVisible(e){if(this.visible===!1)return;e(this);let t=this.children;for(let n=0,i=t.length;n<i;n++)t[n].traverseVisible(e)}traverseAncestors(e){let t=this.parent;t!==null&&(e(t),t.traverseAncestors(e))}updateMatrix(){this.matrix.compose(this.position,this.quaternion,this.scale),this.matrixWorldNeedsUpdate=!0}updateMatrixWorld(e){this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||e)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,e=!0);let t=this.children;for(let n=0,i=t.length;n<i;n++)t[n].updateMatrixWorld(e)}updateWorldMatrix(e,t){let n=this.parent;if(e===!0&&n!==null&&n.updateWorldMatrix(!0,!1),this.matrixAutoUpdate&&this.updateMatrix(),this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),t===!0){let i=this.children;for(let s=0,r=i.length;s<r;s++)i[s].updateWorldMatrix(!1,!0)}}toJSON(e){let t=e===void 0||typeof e=="string",n={};t&&(e={geometries:{},materials:{},textures:{},images:{},shapes:{},skeletons:{},animations:{},nodes:{}},n.metadata={version:4.7,type:"Object",generator:"Object3D.toJSON"});let i={};i.uuid=this.uuid,i.type=this.type,this.name!==""&&(i.name=this.name),this.castShadow===!0&&(i.castShadow=!0),this.receiveShadow===!0&&(i.receiveShadow=!0),this.visible===!1&&(i.visible=!1),this.frustumCulled===!1&&(i.frustumCulled=!1),this.renderOrder!==0&&(i.renderOrder=this.renderOrder),Object.keys(this.userData).length>0&&(i.userData=this.userData),i.layers=this.layers.mask,i.matrix=this.matrix.toArray(),i.up=this.up.toArray(),this.matrixAutoUpdate===!1&&(i.matrixAutoUpdate=!1),this.isInstancedMesh&&(i.type="InstancedMesh",i.count=this.count,i.instanceMatrix=this.instanceMatrix.toJSON(),this.instanceColor!==null&&(i.instanceColor=this.instanceColor.toJSON())),this.isBatchedMesh&&(i.type="BatchedMesh",i.perObjectFrustumCulled=this.perObjectFrustumCulled,i.sortObjects=this.sortObjects,i.drawRanges=this._drawRanges,i.reservedRanges=this._reservedRanges,i.geometryInfo=this._geometryInfo.map(o=>({...o,boundingBox:o.boundingBox?o.boundingBox.toJSON():void 0,boundingSphere:o.boundingSphere?o.boundingSphere.toJSON():void 0})),i.instanceInfo=this._instanceInfo.map(o=>({...o})),i.availableInstanceIds=this._availableInstanceIds.slice(),i.availableGeometryIds=this._availableGeometryIds.slice(),i.nextIndexStart=this._nextIndexStart,i.nextVertexStart=this._nextVertexStart,i.geometryCount=this._geometryCount,i.maxInstanceCount=this._maxInstanceCount,i.maxVertexCount=this._maxVertexCount,i.maxIndexCount=this._maxIndexCount,i.geometryInitialized=this._geometryInitialized,i.matricesTexture=this._matricesTexture.toJSON(e),i.indirectTexture=this._indirectTexture.toJSON(e),this._colorsTexture!==null&&(i.colorsTexture=this._colorsTexture.toJSON(e)),this.boundingSphere!==null&&(i.boundingSphere=this.boundingSphere.toJSON()),this.boundingBox!==null&&(i.boundingBox=this.boundingBox.toJSON()));function s(o,a){return o[a.uuid]===void 0&&(o[a.uuid]=a.toJSON(e)),a.uuid}if(this.isScene)this.background&&(this.background.isColor?i.background=this.background.toJSON():this.background.isTexture&&(i.background=this.background.toJSON(e).uuid)),this.environment&&this.environment.isTexture&&this.environment.isRenderTargetTexture!==!0&&(i.environment=this.environment.toJSON(e).uuid);else if(this.isMesh||this.isLine||this.isPoints){i.geometry=s(e.geometries,this.geometry);let o=this.geometry.parameters;if(o!==void 0&&o.shapes!==void 0){let a=o.shapes;if(Array.isArray(a))for(let c=0,u=a.length;c<u;c++){let h=a[c];s(e.shapes,h)}else s(e.shapes,a)}}if(this.isSkinnedMesh&&(i.bindMode=this.bindMode,i.bindMatrix=this.bindMatrix.toArray(),this.skeleton!==void 0&&(s(e.skeletons,this.skeleton),i.skeleton=this.skeleton.uuid)),this.material!==void 0)if(Array.isArray(this.material)){let o=[];for(let a=0,c=this.material.length;a<c;a++)o.push(s(e.materials,this.material[a]));i.material=o}else i.material=s(e.materials,this.material);if(this.children.length>0){i.children=[];for(let o=0;o<this.children.length;o++)i.children.push(this.children[o].toJSON(e).object)}if(this.animations.length>0){i.animations=[];for(let o=0;o<this.animations.length;o++){let a=this.animations[o];i.animations.push(s(e.animations,a))}}if(t){let o=r(e.geometries),a=r(e.materials),c=r(e.textures),u=r(e.images),h=r(e.shapes),f=r(e.skeletons),d=r(e.animations),p=r(e.nodes);o.length>0&&(n.geometries=o),a.length>0&&(n.materials=a),c.length>0&&(n.textures=c),u.length>0&&(n.images=u),h.length>0&&(n.shapes=h),f.length>0&&(n.skeletons=f),d.length>0&&(n.animations=d),p.length>0&&(n.nodes=p)}return n.object=i,n;function r(o){let a=[];for(let c in o){let u=o[c];delete u.metadata,a.push(u)}return a}}clone(e){return new this.constructor().copy(this,e)}copy(e,t=!0){if(this.name=e.name,this.up.copy(e.up),this.position.copy(e.position),this.rotation.order=e.rotation.order,this.quaternion.copy(e.quaternion),this.scale.copy(e.scale),this.matrix.copy(e.matrix),this.matrixWorld.copy(e.matrixWorld),this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrixWorldAutoUpdate=e.matrixWorldAutoUpdate,this.matrixWorldNeedsUpdate=e.matrixWorldNeedsUpdate,this.layers.mask=e.layers.mask,this.visible=e.visible,this.castShadow=e.castShadow,this.receiveShadow=e.receiveShadow,this.frustumCulled=e.frustumCulled,this.renderOrder=e.renderOrder,this.animations=e.animations.slice(),this.userData=JSON.parse(JSON.stringify(e.userData)),t===!0)for(let n=0;n<e.children.length;n++){let i=e.children[n];this.add(i.clone())}return this}};oe.DEFAULT_UP=new M(0,1,0);oe.DEFAULT_MATRIX_AUTO_UPDATE=!0;oe.DEFAULT_MATRIX_WORLD_AUTO_UPDATE=!0;var et=new M,mt=new M,Hs=new M,gt=new M,yn=new M,vn=new M,aa=new M,Gs=new M,Ws=new M,Xs=new M,qs=new he,Ys=new he,Ks=new he,Ot=class l{constructor(e=new M,t=new M,n=new M){this.a=e,this.b=t,this.c=n}static getNormal(e,t,n,i){i.subVectors(n,t),et.subVectors(e,t),i.cross(et);let s=i.lengthSq();return s>0?i.multiplyScalar(1/Math.sqrt(s)):i.set(0,0,0)}static getBarycoord(e,t,n,i,s){et.subVectors(i,t),mt.subVectors(n,t),Hs.subVectors(e,t);let r=et.dot(et),o=et.dot(mt),a=et.dot(Hs),c=mt.dot(mt),u=mt.dot(Hs),h=r*c-o*o;if(h===0)return s.set(0,0,0),null;let f=1/h,d=(c*a-o*u)*f,p=(r*u-o*a)*f;return s.set(1-d-p,p,d)}static containsPoint(e,t,n,i){return this.getBarycoord(e,t,n,i,gt)===null?!1:gt.x>=0&&gt.y>=0&&gt.x+gt.y<=1}static getInterpolation(e,t,n,i,s,r,o,a){return this.getBarycoord(e,t,n,i,gt)===null?(a.x=0,a.y=0,"z"in a&&(a.z=0),"w"in a&&(a.w=0),null):(a.setScalar(0),a.addScaledVector(s,gt.x),a.addScaledVector(r,gt.y),a.addScaledVector(o,gt.z),a)}static getInterpolatedAttribute(e,t,n,i,s,r){return qs.setScalar(0),Ys.setScalar(0),Ks.setScalar(0),qs.fromBufferAttribute(e,t),Ys.fromBufferAttribute(e,n),Ks.fromBufferAttribute(e,i),r.setScalar(0),r.addScaledVector(qs,s.x),r.addScaledVector(Ys,s.y),r.addScaledVector(Ks,s.z),r}static isFrontFacing(e,t,n,i){return et.subVectors(n,t),mt.subVectors(e,t),et.cross(mt).dot(i)<0}set(e,t,n){return this.a.copy(e),this.b.copy(t),this.c.copy(n),this}setFromPointsAndIndices(e,t,n,i){return this.a.copy(e[t]),this.b.copy(e[n]),this.c.copy(e[i]),this}setFromAttributeAndIndices(e,t,n,i){return this.a.fromBufferAttribute(e,t),this.b.fromBufferAttribute(e,n),this.c.fromBufferAttribute(e,i),this}clone(){return new this.constructor().copy(this)}copy(e){return this.a.copy(e.a),this.b.copy(e.b),this.c.copy(e.c),this}getArea(){return et.subVectors(this.c,this.b),mt.subVectors(this.a,this.b),et.cross(mt).length()*.5}getMidpoint(e){return e.addVectors(this.a,this.b).add(this.c).multiplyScalar(1/3)}getNormal(e){return l.getNormal(this.a,this.b,this.c,e)}getPlane(e){return e.setFromCoplanarPoints(this.a,this.b,this.c)}getBarycoord(e,t){return l.getBarycoord(e,this.a,this.b,this.c,t)}getInterpolation(e,t,n,i,s){return l.getInterpolation(e,this.a,this.b,this.c,t,n,i,s)}containsPoint(e){return l.containsPoint(e,this.a,this.b,this.c)}isFrontFacing(e){return l.isFrontFacing(this.a,this.b,this.c,e)}intersectsBox(e){return e.intersectsTriangle(this)}closestPointToPoint(e,t){let n=this.a,i=this.b,s=this.c,r,o;yn.subVectors(i,n),vn.subVectors(s,n),Gs.subVectors(e,n);let a=yn.dot(Gs),c=vn.dot(Gs);if(a<=0&&c<=0)return t.copy(n);Ws.subVectors(e,i);let u=yn.dot(Ws),h=vn.dot(Ws);if(u>=0&&h<=u)return t.copy(i);let f=a*h-u*c;if(f<=0&&a>=0&&u<=0)return r=a/(a-u),t.copy(n).addScaledVector(yn,r);Xs.subVectors(e,s);let d=yn.dot(Xs),p=vn.dot(Xs);if(p>=0&&d<=p)return t.copy(s);let g=d*c-a*p;if(g<=0&&c>=0&&p<=0)return o=c/(c-p),t.copy(n).addScaledVector(vn,o);let m=u*p-d*h;if(m<=0&&h-u>=0&&d-p>=0)return aa.subVectors(s,i),o=(h-u)/(h-u+(d-p)),t.copy(i).addScaledVector(aa,o);let x=1/(m+g+f);return r=g*x,o=f*x,t.copy(n).addScaledVector(yn,r).addScaledVector(vn,o)}equals(e){return e.a.equals(this.a)&&e.b.equals(this.b)&&e.c.equals(this.c)}},za={aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074},Nt={h:0,s:0,l:0},Li={h:0,s:0,l:0};function Zs(l,e,t){return t<0&&(t+=1),t>1&&(t-=1),t<1/6?l+(e-l)*6*t:t<1/2?e:t<2/3?l+(e-l)*6*(2/3-t):l}var L=class{constructor(e,t,n){return this.isColor=!0,this.r=1,this.g=1,this.b=1,this.set(e,t,n)}set(e,t,n){if(t===void 0&&n===void 0){let i=e;i&&i.isColor?this.copy(i):typeof i=="number"?this.setHex(i):typeof i=="string"&&this.setStyle(i)}else this.setRGB(e,t,n);return this}setScalar(e){return this.r=e,this.g=e,this.b=e,this}setHex(e,t=O){return e=Math.floor(e),this.r=(e>>16&255)/255,this.g=(e>>8&255)/255,this.b=(e&255)/255,re.colorSpaceToWorking(this,t),this}setRGB(e,t,n,i=re.workingColorSpace){return this.r=e,this.g=t,this.b=n,re.colorSpaceToWorking(this,i),this}setHSL(e,t,n,i=re.workingColorSpace){if(e=Fr(e,1),t=G(t,0,1),n=G(n,0,1),t===0)this.r=this.g=this.b=n;else{let s=n<=.5?n*(1+t):n+t-n*t,r=2*n-s;this.r=Zs(r,s,e+1/3),this.g=Zs(r,s,e),this.b=Zs(r,s,e-1/3)}return re.colorSpaceToWorking(this,i),this}setStyle(e,t=O){function n(s){s!==void 0&&parseFloat(s)<1&&console.warn("THREE.Color: Alpha component of "+e+" will be ignored.")}let i;if(i=/^(\w+)\(([^\)]*)\)/.exec(e)){let s,r=i[1],o=i[2];switch(r){case"rgb":case"rgba":if(s=/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return n(s[4]),this.setRGB(Math.min(255,parseInt(s[1],10))/255,Math.min(255,parseInt(s[2],10))/255,Math.min(255,parseInt(s[3],10))/255,t);if(s=/^\s*(\d+)\%\s*,\s*(\d+)\%\s*,\s*(\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return n(s[4]),this.setRGB(Math.min(100,parseInt(s[1],10))/100,Math.min(100,parseInt(s[2],10))/100,Math.min(100,parseInt(s[3],10))/100,t);break;case"hsl":case"hsla":if(s=/^\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\%\s*,\s*(\d*\.?\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return n(s[4]),this.setHSL(parseFloat(s[1])/360,parseFloat(s[2])/100,parseFloat(s[3])/100,t);break;default:console.warn("THREE.Color: Unknown color model "+e)}}else if(i=/^\#([A-Fa-f\d]+)$/.exec(e)){let s=i[1],r=s.length;if(r===3)return this.setRGB(parseInt(s.charAt(0),16)/15,parseInt(s.charAt(1),16)/15,parseInt(s.charAt(2),16)/15,t);if(r===6)return this.setHex(parseInt(s,16),t);console.warn("THREE.Color: Invalid hex color "+e)}else if(e&&e.length>0)return this.setColorName(e,t);return this}setColorName(e,t=O){let n=za[e.toLowerCase()];return n!==void 0?this.setHex(n,t):console.warn("THREE.Color: Unknown color "+e),this}clone(){return new this.constructor(this.r,this.g,this.b)}copy(e){return this.r=e.r,this.g=e.g,this.b=e.b,this}copySRGBToLinear(e){return this.r=yt(e.r),this.g=yt(e.g),this.b=yt(e.b),this}copyLinearToSRGB(e){return this.r=bn(e.r),this.g=bn(e.g),this.b=bn(e.b),this}convertSRGBToLinear(){return this.copySRGBToLinear(this),this}convertLinearToSRGB(){return this.copyLinearToSRGB(this),this}getHex(e=O){return re.workingToColorSpace(Se.copy(this),e),Math.round(G(Se.r*255,0,255))*65536+Math.round(G(Se.g*255,0,255))*256+Math.round(G(Se.b*255,0,255))}getHexString(e=O){return("000000"+this.getHex(e).toString(16)).slice(-6)}getHSL(e,t=re.workingColorSpace){re.workingToColorSpace(Se.copy(this),t);let n=Se.r,i=Se.g,s=Se.b,r=Math.max(n,i,s),o=Math.min(n,i,s),a,c,u=(o+r)/2;if(o===r)a=0,c=0;else{let h=r-o;switch(c=u<=.5?h/(r+o):h/(2-r-o),r){case n:a=(i-s)/h+(i<s?6:0);break;case i:a=(s-n)/h+2;break;case s:a=(n-i)/h+4;break}a/=6}return e.h=a,e.s=c,e.l=u,e}getRGB(e,t=re.workingColorSpace){return re.workingToColorSpace(Se.copy(this),t),e.r=Se.r,e.g=Se.g,e.b=Se.b,e}getStyle(e=O){re.workingToColorSpace(Se.copy(this),e);let t=Se.r,n=Se.g,i=Se.b;return e!==O?`color(${e} ${t.toFixed(3)} ${n.toFixed(3)} ${i.toFixed(3)})`:`rgb(${Math.round(t*255)},${Math.round(n*255)},${Math.round(i*255)})`}offsetHSL(e,t,n){return this.getHSL(Nt),this.setHSL(Nt.h+e,Nt.s+t,Nt.l+n)}add(e){return this.r+=e.r,this.g+=e.g,this.b+=e.b,this}addColors(e,t){return this.r=e.r+t.r,this.g=e.g+t.g,this.b=e.b+t.b,this}addScalar(e){return this.r+=e,this.g+=e,this.b+=e,this}sub(e){return this.r=Math.max(0,this.r-e.r),this.g=Math.max(0,this.g-e.g),this.b=Math.max(0,this.b-e.b),this}multiply(e){return this.r*=e.r,this.g*=e.g,this.b*=e.b,this}multiplyScalar(e){return this.r*=e,this.g*=e,this.b*=e,this}lerp(e,t){return this.r+=(e.r-this.r)*t,this.g+=(e.g-this.g)*t,this.b+=(e.b-this.b)*t,this}lerpColors(e,t,n){return this.r=e.r+(t.r-e.r)*n,this.g=e.g+(t.g-e.g)*n,this.b=e.b+(t.b-e.b)*n,this}lerpHSL(e,t){this.getHSL(Nt),e.getHSL(Li);let n=jn(Nt.h,Li.h,t),i=jn(Nt.s,Li.s,t),s=jn(Nt.l,Li.l,t);return this.setHSL(n,i,s),this}setFromVector3(e){return this.r=e.x,this.g=e.y,this.b=e.z,this}applyMatrix3(e){let t=this.r,n=this.g,i=this.b,s=e.elements;return this.r=s[0]*t+s[3]*n+s[6]*i,this.g=s[1]*t+s[4]*n+s[7]*i,this.b=s[2]*t+s[5]*n+s[8]*i,this}equals(e){return e.r===this.r&&e.g===this.g&&e.b===this.b}fromArray(e,t=0){return this.r=e[t],this.g=e[t+1],this.b=e[t+2],this}toArray(e=[],t=0){return e[t]=this.r,e[t+1]=this.g,e[t+2]=this.b,e}fromBufferAttribute(e,t){return this.r=e.getX(t),this.g=e.getY(t),this.b=e.getZ(t),this}toJSON(){return this.getHex()}*[Symbol.iterator](){yield this.r,yield this.g,yield this.b}},Se=new L;L.NAMES=za;var Zc=0,Te=class extends jt{constructor(){super(),this.isMaterial=!0,Object.defineProperty(this,"id",{value:Zc++}),this.uuid=it(),this.name="",this.type="Material",this.blending=rr,this.side=zt,this.vertexColors=!1,this.opacity=1,this.transparent=!1,this.alphaHash=!1,this.blendSrc=ar,this.blendDst=cr,this.blendEquation=or,this.blendSrcAlpha=null,this.blendDstAlpha=null,this.blendEquationAlpha=null,this.blendColor=new L(0,0,0),this.blendAlpha=0,this.depthFunc=$n,this.depthTest=!0,this.depthWrite=!0,this.stencilWriteMask=255,this.stencilFunc=pr,this.stencilRef=0,this.stencilFuncMask=255,this.stencilFail=Zt,this.stencilZFail=Zt,this.stencilZPass=Zt,this.stencilWrite=!1,this.clippingPlanes=null,this.clipIntersection=!1,this.clipShadows=!1,this.shadowSide=null,this.colorWrite=!0,this.precision=null,this.polygonOffset=!1,this.polygonOffsetFactor=0,this.polygonOffsetUnits=0,this.dithering=!1,this.alphaToCoverage=!1,this.premultipliedAlpha=!1,this.forceSinglePass=!1,this.allowOverride=!0,this.visible=!0,this.toneMapped=!0,this.userData={},this.version=0,this._alphaTest=0}get alphaTest(){return this._alphaTest}set alphaTest(e){this._alphaTest>0!=e>0&&this.version++,this._alphaTest=e}onBeforeRender(){}onBeforeCompile(){}customProgramCacheKey(){return this.onBeforeCompile.toString()}setValues(e){if(e!==void 0)for(let t in e){let n=e[t];if(n===void 0){console.warn(`THREE.Material: parameter '${t}' has value of undefined.`);continue}let i=this[t];if(i===void 0){console.warn(`THREE.Material: '${t}' is not a property of THREE.${this.type}.`);continue}i&&i.isColor?i.set(n):i&&i.isVector3&&n&&n.isVector3?i.copy(n):this[t]=n}}toJSON(e){let t=e===void 0||typeof e=="string";t&&(e={textures:{},images:{}});let n={metadata:{version:4.7,type:"Material",generator:"Material.toJSON"}};n.uuid=this.uuid,n.type=this.type,this.name!==""&&(n.name=this.name),this.color&&this.color.isColor&&(n.color=this.color.getHex()),this.roughness!==void 0&&(n.roughness=this.roughness),this.metalness!==void 0&&(n.metalness=this.metalness),this.sheen!==void 0&&(n.sheen=this.sheen),this.sheenColor&&this.sheenColor.isColor&&(n.sheenColor=this.sheenColor.getHex()),this.sheenRoughness!==void 0&&(n.sheenRoughness=this.sheenRoughness),this.emissive&&this.emissive.isColor&&(n.emissive=this.emissive.getHex()),this.emissiveIntensity!==void 0&&this.emissiveIntensity!==1&&(n.emissiveIntensity=this.emissiveIntensity),this.specular&&this.specular.isColor&&(n.specular=this.specular.getHex()),this.specularIntensity!==void 0&&(n.specularIntensity=this.specularIntensity),this.specularColor&&this.specularColor.isColor&&(n.specularColor=this.specularColor.getHex()),this.shininess!==void 0&&(n.shininess=this.shininess),this.clearcoat!==void 0&&(n.clearcoat=this.clearcoat),this.clearcoatRoughness!==void 0&&(n.clearcoatRoughness=this.clearcoatRoughness),this.clearcoatMap&&this.clearcoatMap.isTexture&&(n.clearcoatMap=this.clearcoatMap.toJSON(e).uuid),this.clearcoatRoughnessMap&&this.clearcoatRoughnessMap.isTexture&&(n.clearcoatRoughnessMap=this.clearcoatRoughnessMap.toJSON(e).uuid),this.clearcoatNormalMap&&this.clearcoatNormalMap.isTexture&&(n.clearcoatNormalMap=this.clearcoatNormalMap.toJSON(e).uuid,n.clearcoatNormalScale=this.clearcoatNormalScale.toArray()),this.sheenColorMap&&this.sheenColorMap.isTexture&&(n.sheenColorMap=this.sheenColorMap.toJSON(e).uuid),this.sheenRoughnessMap&&this.sheenRoughnessMap.isTexture&&(n.sheenRoughnessMap=this.sheenRoughnessMap.toJSON(e).uuid),this.dispersion!==void 0&&(n.dispersion=this.dispersion),this.iridescence!==void 0&&(n.iridescence=this.iridescence),this.iridescenceIOR!==void 0&&(n.iridescenceIOR=this.iridescenceIOR),this.iridescenceThicknessRange!==void 0&&(n.iridescenceThicknessRange=this.iridescenceThicknessRange),this.iridescenceMap&&this.iridescenceMap.isTexture&&(n.iridescenceMap=this.iridescenceMap.toJSON(e).uuid),this.iridescenceThicknessMap&&this.iridescenceThicknessMap.isTexture&&(n.iridescenceThicknessMap=this.iridescenceThicknessMap.toJSON(e).uuid),this.anisotropy!==void 0&&(n.anisotropy=this.anisotropy),this.anisotropyRotation!==void 0&&(n.anisotropyRotation=this.anisotropyRotation),this.anisotropyMap&&this.anisotropyMap.isTexture&&(n.anisotropyMap=this.anisotropyMap.toJSON(e).uuid),this.map&&this.map.isTexture&&(n.map=this.map.toJSON(e).uuid),this.matcap&&this.matcap.isTexture&&(n.matcap=this.matcap.toJSON(e).uuid),this.alphaMap&&this.alphaMap.isTexture&&(n.alphaMap=this.alphaMap.toJSON(e).uuid),this.lightMap&&this.lightMap.isTexture&&(n.lightMap=this.lightMap.toJSON(e).uuid,n.lightMapIntensity=this.lightMapIntensity),this.aoMap&&this.aoMap.isTexture&&(n.aoMap=this.aoMap.toJSON(e).uuid,n.aoMapIntensity=this.aoMapIntensity),this.bumpMap&&this.bumpMap.isTexture&&(n.bumpMap=this.bumpMap.toJSON(e).uuid,n.bumpScale=this.bumpScale),this.normalMap&&this.normalMap.isTexture&&(n.normalMap=this.normalMap.toJSON(e).uuid,n.normalMapType=this.normalMapType,n.normalScale=this.normalScale.toArray()),this.displacementMap&&this.displacementMap.isTexture&&(n.displacementMap=this.displacementMap.toJSON(e).uuid,n.displacementScale=this.displacementScale,n.displacementBias=this.displacementBias),this.roughnessMap&&this.roughnessMap.isTexture&&(n.roughnessMap=this.roughnessMap.toJSON(e).uuid),this.metalnessMap&&this.metalnessMap.isTexture&&(n.metalnessMap=this.metalnessMap.toJSON(e).uuid),this.emissiveMap&&this.emissiveMap.isTexture&&(n.emissiveMap=this.emissiveMap.toJSON(e).uuid),this.specularMap&&this.specularMap.isTexture&&(n.specularMap=this.specularMap.toJSON(e).uuid),this.specularIntensityMap&&this.specularIntensityMap.isTexture&&(n.specularIntensityMap=this.specularIntensityMap.toJSON(e).uuid),this.specularColorMap&&this.specularColorMap.isTexture&&(n.specularColorMap=this.specularColorMap.toJSON(e).uuid),this.envMap&&this.envMap.isTexture&&(n.envMap=this.envMap.toJSON(e).uuid,this.combine!==void 0&&(n.combine=this.combine)),this.envMapRotation!==void 0&&(n.envMapRotation=this.envMapRotation.toArray()),this.envMapIntensity!==void 0&&(n.envMapIntensity=this.envMapIntensity),this.reflectivity!==void 0&&(n.reflectivity=this.reflectivity),this.refractionRatio!==void 0&&(n.refractionRatio=this.refractionRatio),this.gradientMap&&this.gradientMap.isTexture&&(n.gradientMap=this.gradientMap.toJSON(e).uuid),this.transmission!==void 0&&(n.transmission=this.transmission),this.transmissionMap&&this.transmissionMap.isTexture&&(n.transmissionMap=this.transmissionMap.toJSON(e).uuid),this.thickness!==void 0&&(n.thickness=this.thickness),this.thicknessMap&&this.thicknessMap.isTexture&&(n.thicknessMap=this.thicknessMap.toJSON(e).uuid),this.attenuationDistance!==void 0&&this.attenuationDistance!==1/0&&(n.attenuationDistance=this.attenuationDistance),this.attenuationColor!==void 0&&(n.attenuationColor=this.attenuationColor.getHex()),this.size!==void 0&&(n.size=this.size),this.shadowSide!==null&&(n.shadowSide=this.shadowSide),this.sizeAttenuation!==void 0&&(n.sizeAttenuation=this.sizeAttenuation),this.blending!==rr&&(n.blending=this.blending),this.side!==zt&&(n.side=this.side),this.vertexColors===!0&&(n.vertexColors=!0),this.opacity<1&&(n.opacity=this.opacity),this.transparent===!0&&(n.transparent=!0),this.blendSrc!==ar&&(n.blendSrc=this.blendSrc),this.blendDst!==cr&&(n.blendDst=this.blendDst),this.blendEquation!==or&&(n.blendEquation=this.blendEquation),this.blendSrcAlpha!==null&&(n.blendSrcAlpha=this.blendSrcAlpha),this.blendDstAlpha!==null&&(n.blendDstAlpha=this.blendDstAlpha),this.blendEquationAlpha!==null&&(n.blendEquationAlpha=this.blendEquationAlpha),this.blendColor&&this.blendColor.isColor&&(n.blendColor=this.blendColor.getHex()),this.blendAlpha!==0&&(n.blendAlpha=this.blendAlpha),this.depthFunc!==$n&&(n.depthFunc=this.depthFunc),this.depthTest===!1&&(n.depthTest=this.depthTest),this.depthWrite===!1&&(n.depthWrite=this.depthWrite),this.colorWrite===!1&&(n.colorWrite=this.colorWrite),this.stencilWriteMask!==255&&(n.stencilWriteMask=this.stencilWriteMask),this.stencilFunc!==pr&&(n.stencilFunc=this.stencilFunc),this.stencilRef!==0&&(n.stencilRef=this.stencilRef),this.stencilFuncMask!==255&&(n.stencilFuncMask=this.stencilFuncMask),this.stencilFail!==Zt&&(n.stencilFail=this.stencilFail),this.stencilZFail!==Zt&&(n.stencilZFail=this.stencilZFail),this.stencilZPass!==Zt&&(n.stencilZPass=this.stencilZPass),this.stencilWrite===!0&&(n.stencilWrite=this.stencilWrite),this.rotation!==void 0&&this.rotation!==0&&(n.rotation=this.rotation),this.polygonOffset===!0&&(n.polygonOffset=!0),this.polygonOffsetFactor!==0&&(n.polygonOffsetFactor=this.polygonOffsetFactor),this.polygonOffsetUnits!==0&&(n.polygonOffsetUnits=this.polygonOffsetUnits),this.linewidth!==void 0&&this.linewidth!==1&&(n.linewidth=this.linewidth),this.dashSize!==void 0&&(n.dashSize=this.dashSize),this.gapSize!==void 0&&(n.gapSize=this.gapSize),this.scale!==void 0&&(n.scale=this.scale),this.dithering===!0&&(n.dithering=!0),this.alphaTest>0&&(n.alphaTest=this.alphaTest),this.alphaHash===!0&&(n.alphaHash=!0),this.alphaToCoverage===!0&&(n.alphaToCoverage=!0),this.premultipliedAlpha===!0&&(n.premultipliedAlpha=!0),this.forceSinglePass===!0&&(n.forceSinglePass=!0),this.wireframe===!0&&(n.wireframe=!0),this.wireframeLinewidth>1&&(n.wireframeLinewidth=this.wireframeLinewidth),this.wireframeLinecap!=="round"&&(n.wireframeLinecap=this.wireframeLinecap),this.wireframeLinejoin!=="round"&&(n.wireframeLinejoin=this.wireframeLinejoin),this.flatShading===!0&&(n.flatShading=!0),this.visible===!1&&(n.visible=!1),this.toneMapped===!1&&(n.toneMapped=!1),this.fog===!1&&(n.fog=!1),Object.keys(this.userData).length>0&&(n.userData=this.userData);function i(s){let r=[];for(let o in s){let a=s[o];delete a.metadata,r.push(a)}return r}if(t){let s=i(e.textures),r=i(e.images);s.length>0&&(n.textures=s),r.length>0&&(n.images=r)}return n}clone(){return new this.constructor().copy(this)}copy(e){this.name=e.name,this.blending=e.blending,this.side=e.side,this.vertexColors=e.vertexColors,this.opacity=e.opacity,this.transparent=e.transparent,this.blendSrc=e.blendSrc,this.blendDst=e.blendDst,this.blendEquation=e.blendEquation,this.blendSrcAlpha=e.blendSrcAlpha,this.blendDstAlpha=e.blendDstAlpha,this.blendEquationAlpha=e.blendEquationAlpha,this.blendColor.copy(e.blendColor),this.blendAlpha=e.blendAlpha,this.depthFunc=e.depthFunc,this.depthTest=e.depthTest,this.depthWrite=e.depthWrite,this.stencilWriteMask=e.stencilWriteMask,this.stencilFunc=e.stencilFunc,this.stencilRef=e.stencilRef,this.stencilFuncMask=e.stencilFuncMask,this.stencilFail=e.stencilFail,this.stencilZFail=e.stencilZFail,this.stencilZPass=e.stencilZPass,this.stencilWrite=e.stencilWrite;let t=e.clippingPlanes,n=null;if(t!==null){let i=t.length;n=new Array(i);for(let s=0;s!==i;++s)n[s]=t[s].clone()}return this.clippingPlanes=n,this.clipIntersection=e.clipIntersection,this.clipShadows=e.clipShadows,this.shadowSide=e.shadowSide,this.colorWrite=e.colorWrite,this.precision=e.precision,this.polygonOffset=e.polygonOffset,this.polygonOffsetFactor=e.polygonOffsetFactor,this.polygonOffsetUnits=e.polygonOffsetUnits,this.dithering=e.dithering,this.alphaTest=e.alphaTest,this.alphaHash=e.alphaHash,this.alphaToCoverage=e.alphaToCoverage,this.premultipliedAlpha=e.premultipliedAlpha,this.forceSinglePass=e.forceSinglePass,this.visible=e.visible,this.toneMapped=e.toneMapped,this.userData=JSON.parse(JSON.stringify(e.userData)),this}dispose(){this.dispatchEvent({type:"dispose"})}set needsUpdate(e){e===!0&&this.version++}},ct=class extends Te{constructor(e){super(),this.isMeshBasicMaterial=!0,this.type="MeshBasicMaterial",this.color=new L(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new _e,this.combine=fs,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.specularMap=e.specularMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.combine=e.combine,this.reflectivity=e.reflectivity,this.refractionRatio=e.refractionRatio,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.fog=e.fog,this}};var xe=new M,Di=new Z,Jc=0,se=class{constructor(e,t,n=!1){if(Array.isArray(e))throw new TypeError("THREE.BufferAttribute: array should be a Typed Array.");this.isBufferAttribute=!0,Object.defineProperty(this,"id",{value:Jc++}),this.name="",this.array=e,this.itemSize=t,this.count=e!==void 0?e.length/t:0,this.normalized=n,this.usage=Qi,this.updateRanges=[],this.gpuType=ds,this.version=0}onUploadCallback(){}set needsUpdate(e){e===!0&&this.version++}setUsage(e){return this.usage=e,this}addUpdateRange(e,t){this.updateRanges.push({start:e,count:t})}clearUpdateRanges(){this.updateRanges.length=0}copy(e){return this.name=e.name,this.array=new e.array.constructor(e.array),this.itemSize=e.itemSize,this.count=e.count,this.normalized=e.normalized,this.usage=e.usage,this.gpuType=e.gpuType,this}copyAt(e,t,n){e*=this.itemSize,n*=t.itemSize;for(let i=0,s=this.itemSize;i<s;i++)this.array[e+i]=t.array[n+i];return this}copyArray(e){return this.array.set(e),this}applyMatrix3(e){if(this.itemSize===2)for(let t=0,n=this.count;t<n;t++)Di.fromBufferAttribute(this,t),Di.applyMatrix3(e),this.setXY(t,Di.x,Di.y);else if(this.itemSize===3)for(let t=0,n=this.count;t<n;t++)xe.fromBufferAttribute(this,t),xe.applyMatrix3(e),this.setXYZ(t,xe.x,xe.y,xe.z);return this}applyMatrix4(e){for(let t=0,n=this.count;t<n;t++)xe.fromBufferAttribute(this,t),xe.applyMatrix4(e),this.setXYZ(t,xe.x,xe.y,xe.z);return this}applyNormalMatrix(e){for(let t=0,n=this.count;t<n;t++)xe.fromBufferAttribute(this,t),xe.applyNormalMatrix(e),this.setXYZ(t,xe.x,xe.y,xe.z);return this}transformDirection(e){for(let t=0,n=this.count;t<n;t++)xe.fromBufferAttribute(this,t),xe.transformDirection(e),this.setXYZ(t,xe.x,xe.y,xe.z);return this}set(e,t=0){return this.array.set(e,t),this}getComponent(e,t){let n=this.array[e*this.itemSize+t];return this.normalized&&(n=tt(n,this.array)),n}setComponent(e,t,n){return this.normalized&&(n=ie(n,this.array)),this.array[e*this.itemSize+t]=n,this}getX(e){let t=this.array[e*this.itemSize];return this.normalized&&(t=tt(t,this.array)),t}setX(e,t){return this.normalized&&(t=ie(t,this.array)),this.array[e*this.itemSize]=t,this}getY(e){let t=this.array[e*this.itemSize+1];return this.normalized&&(t=tt(t,this.array)),t}setY(e,t){return this.normalized&&(t=ie(t,this.array)),this.array[e*this.itemSize+1]=t,this}getZ(e){let t=this.array[e*this.itemSize+2];return this.normalized&&(t=tt(t,this.array)),t}setZ(e,t){return this.normalized&&(t=ie(t,this.array)),this.array[e*this.itemSize+2]=t,this}getW(e){let t=this.array[e*this.itemSize+3];return this.normalized&&(t=tt(t,this.array)),t}setW(e,t){return this.normalized&&(t=ie(t,this.array)),this.array[e*this.itemSize+3]=t,this}setXY(e,t,n){return e*=this.itemSize,this.normalized&&(t=ie(t,this.array),n=ie(n,this.array)),this.array[e+0]=t,this.array[e+1]=n,this}setXYZ(e,t,n,i){return e*=this.itemSize,this.normalized&&(t=ie(t,this.array),n=ie(n,this.array),i=ie(i,this.array)),this.array[e+0]=t,this.array[e+1]=n,this.array[e+2]=i,this}setXYZW(e,t,n,i,s){return e*=this.itemSize,this.normalized&&(t=ie(t,this.array),n=ie(n,this.array),i=ie(i,this.array),s=ie(s,this.array)),this.array[e+0]=t,this.array[e+1]=n,this.array[e+2]=i,this.array[e+3]=s,this}onUpload(e){return this.onUploadCallback=e,this}clone(){return new this.constructor(this.array,this.itemSize).copy(this)}toJSON(){let e={itemSize:this.itemSize,type:this.array.constructor.name,array:Array.from(this.array),normalized:this.normalized};return this.name!==""&&(e.name=this.name),this.usage!==Qi&&(e.usage=this.usage),e}};var Rn=class extends se{constructor(e,t,n){super(new Uint16Array(e),t,n)}};var is=class extends se{constructor(e,t,n){super(new Uint32Array(e),t,n)}};var Q=class extends se{constructor(e,t,n){super(new Float32Array(e),t,n)}},jc=0,We=new D,Js=new oe,Mn=new M,Be=new ke,Wn=new ke,ye=new M,me=class l extends jt{constructor(){super(),this.isBufferGeometry=!0,Object.defineProperty(this,"id",{value:jc++}),this.uuid=it(),this.name="",this.type="BufferGeometry",this.index=null,this.indirect=null,this.attributes={},this.morphAttributes={},this.morphTargetsRelative=!1,this.groups=[],this.boundingBox=null,this.boundingSphere=null,this.drawRange={start:0,count:1/0},this.userData={}}getIndex(){return this.index}setIndex(e){return Array.isArray(e)?this.index=new(Ba(e)?is:Rn)(e,1):this.index=e,this}setIndirect(e){return this.indirect=e,this}getIndirect(){return this.indirect}getAttribute(e){return this.attributes[e]}setAttribute(e,t){return this.attributes[e]=t,this}deleteAttribute(e){return delete this.attributes[e],this}hasAttribute(e){return this.attributes[e]!==void 0}addGroup(e,t,n=0){this.groups.push({start:e,count:t,materialIndex:n})}clearGroups(){this.groups=[]}setDrawRange(e,t){this.drawRange.start=e,this.drawRange.count=t}applyMatrix4(e){let t=this.attributes.position;t!==void 0&&(t.applyMatrix4(e),t.needsUpdate=!0);let n=this.attributes.normal;if(n!==void 0){let s=new k().getNormalMatrix(e);n.applyNormalMatrix(s),n.needsUpdate=!0}let i=this.attributes.tangent;return i!==void 0&&(i.transformDirection(e),i.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this}applyQuaternion(e){return We.makeRotationFromQuaternion(e),this.applyMatrix4(We),this}rotateX(e){return We.makeRotationX(e),this.applyMatrix4(We),this}rotateY(e){return We.makeRotationY(e),this.applyMatrix4(We),this}rotateZ(e){return We.makeRotationZ(e),this.applyMatrix4(We),this}translate(e,t,n){return We.makeTranslation(e,t,n),this.applyMatrix4(We),this}scale(e,t,n){return We.makeScale(e,t,n),this.applyMatrix4(We),this}lookAt(e){return Js.lookAt(e),Js.updateMatrix(),this.applyMatrix4(Js.matrix),this}center(){return this.computeBoundingBox(),this.boundingBox.getCenter(Mn).negate(),this.translate(Mn.x,Mn.y,Mn.z),this}setFromPoints(e){let t=this.getAttribute("position");if(t===void 0){let n=[];for(let i=0,s=e.length;i<s;i++){let r=e[i];n.push(r.x,r.y,r.z||0)}this.setAttribute("position",new Q(n,3))}else{let n=Math.min(e.length,t.count);for(let i=0;i<n;i++){let s=e[i];t.setXYZ(i,s.x,s.y,s.z||0)}e.length>t.count&&console.warn("THREE.BufferGeometry: Buffer size too small for points data. Use .dispose() and create a new geometry."),t.needsUpdate=!0}return this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new ke);let e=this.attributes.position,t=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){console.error("THREE.BufferGeometry.computeBoundingBox(): GLBufferAttribute requires a manual bounding box.",this),this.boundingBox.set(new M(-1/0,-1/0,-1/0),new M(1/0,1/0,1/0));return}if(e!==void 0){if(this.boundingBox.setFromBufferAttribute(e),t)for(let n=0,i=t.length;n<i;n++){let s=t[n];Be.setFromBufferAttribute(s),this.morphTargetsRelative?(ye.addVectors(this.boundingBox.min,Be.min),this.boundingBox.expandByPoint(ye),ye.addVectors(this.boundingBox.max,Be.max),this.boundingBox.expandByPoint(ye)):(this.boundingBox.expandByPoint(Be.min),this.boundingBox.expandByPoint(Be.max))}}else this.boundingBox.makeEmpty();(isNaN(this.boundingBox.min.x)||isNaN(this.boundingBox.min.y)||isNaN(this.boundingBox.min.z))&&console.error('THREE.BufferGeometry.computeBoundingBox(): Computed min/max have NaN values. The "position" attribute is likely to have NaN values.',this)}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new Pe);let e=this.attributes.position,t=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){console.error("THREE.BufferGeometry.computeBoundingSphere(): GLBufferAttribute requires a manual bounding sphere.",this),this.boundingSphere.set(new M,1/0);return}if(e){let n=this.boundingSphere.center;if(Be.setFromBufferAttribute(e),t)for(let s=0,r=t.length;s<r;s++){let o=t[s];Wn.setFromBufferAttribute(o),this.morphTargetsRelative?(ye.addVectors(Be.min,Wn.min),Be.expandByPoint(ye),ye.addVectors(Be.max,Wn.max),Be.expandByPoint(ye)):(Be.expandByPoint(Wn.min),Be.expandByPoint(Wn.max))}Be.getCenter(n);let i=0;for(let s=0,r=e.count;s<r;s++)ye.fromBufferAttribute(e,s),i=Math.max(i,n.distanceToSquared(ye));if(t)for(let s=0,r=t.length;s<r;s++){let o=t[s],a=this.morphTargetsRelative;for(let c=0,u=o.count;c<u;c++)ye.fromBufferAttribute(o,c),a&&(Mn.fromBufferAttribute(e,c),ye.add(Mn)),i=Math.max(i,n.distanceToSquared(ye))}this.boundingSphere.radius=Math.sqrt(i),isNaN(this.boundingSphere.radius)&&console.error('THREE.BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.',this)}}computeTangents(){let e=this.index,t=this.attributes;if(e===null||t.position===void 0||t.normal===void 0||t.uv===void 0){console.error("THREE.BufferGeometry: .computeTangents() failed. Missing required attributes (index, position, normal or uv)");return}let n=t.position,i=t.normal,s=t.uv;this.hasAttribute("tangent")===!1&&this.setAttribute("tangent",new se(new Float32Array(4*n.count),4));let r=this.getAttribute("tangent"),o=[],a=[];for(let w=0;w<n.count;w++)o[w]=new M,a[w]=new M;let c=new M,u=new M,h=new M,f=new Z,d=new Z,p=new Z,g=new M,m=new M;function x(w,E,C){c.fromBufferAttribute(n,w),u.fromBufferAttribute(n,E),h.fromBufferAttribute(n,C),f.fromBufferAttribute(s,w),d.fromBufferAttribute(s,E),p.fromBufferAttribute(s,C),u.sub(c),h.sub(c),d.sub(f),p.sub(f);let A=1/(d.x*p.y-p.x*d.y);isFinite(A)&&(g.copy(u).multiplyScalar(p.y).addScaledVector(h,-d.y).multiplyScalar(A),m.copy(h).multiplyScalar(d.x).addScaledVector(u,-p.x).multiplyScalar(A),o[w].add(g),o[E].add(g),o[C].add(g),a[w].add(m),a[E].add(m),a[C].add(m))}let v=this.groups;v.length===0&&(v=[{start:0,count:e.count}]);for(let w=0,E=v.length;w<E;++w){let C=v[w],A=C.start,K=C.count;for(let $=A,le=A+K;$<le;$+=3)x(e.getX($+0),e.getX($+1),e.getX($+2))}let y=new M,_=new M,S=new M,T=new M;function b(w){S.fromBufferAttribute(i,w),T.copy(S);let E=o[w];y.copy(E),y.sub(S.multiplyScalar(S.dot(E))).normalize(),_.crossVectors(T,E);let A=_.dot(a[w])<0?-1:1;r.setXYZW(w,y.x,y.y,y.z,A)}for(let w=0,E=v.length;w<E;++w){let C=v[w],A=C.start,K=C.count;for(let $=A,le=A+K;$<le;$+=3)b(e.getX($+0)),b(e.getX($+1)),b(e.getX($+2))}}computeVertexNormals(){let e=this.index,t=this.getAttribute("position");if(t!==void 0){let n=this.getAttribute("normal");if(n===void 0)n=new se(new Float32Array(t.count*3),3),this.setAttribute("normal",n);else for(let f=0,d=n.count;f<d;f++)n.setXYZ(f,0,0,0);let i=new M,s=new M,r=new M,o=new M,a=new M,c=new M,u=new M,h=new M;if(e)for(let f=0,d=e.count;f<d;f+=3){let p=e.getX(f+0),g=e.getX(f+1),m=e.getX(f+2);i.fromBufferAttribute(t,p),s.fromBufferAttribute(t,g),r.fromBufferAttribute(t,m),u.subVectors(r,s),h.subVectors(i,s),u.cross(h),o.fromBufferAttribute(n,p),a.fromBufferAttribute(n,g),c.fromBufferAttribute(n,m),o.add(u),a.add(u),c.add(u),n.setXYZ(p,o.x,o.y,o.z),n.setXYZ(g,a.x,a.y,a.z),n.setXYZ(m,c.x,c.y,c.z)}else for(let f=0,d=t.count;f<d;f+=3)i.fromBufferAttribute(t,f+0),s.fromBufferAttribute(t,f+1),r.fromBufferAttribute(t,f+2),u.subVectors(r,s),h.subVectors(i,s),u.cross(h),n.setXYZ(f+0,u.x,u.y,u.z),n.setXYZ(f+1,u.x,u.y,u.z),n.setXYZ(f+2,u.x,u.y,u.z);this.normalizeNormals(),n.needsUpdate=!0}}normalizeNormals(){let e=this.attributes.normal;for(let t=0,n=e.count;t<n;t++)ye.fromBufferAttribute(e,t),ye.normalize(),e.setXYZ(t,ye.x,ye.y,ye.z)}toNonIndexed(){function e(o,a){let c=o.array,u=o.itemSize,h=o.normalized,f=new c.constructor(a.length*u),d=0,p=0;for(let g=0,m=a.length;g<m;g++){o.isInterleavedBufferAttribute?d=a[g]*o.data.stride+o.offset:d=a[g]*u;for(let x=0;x<u;x++)f[p++]=c[d++]}return new se(f,u,h)}if(this.index===null)return console.warn("THREE.BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed."),this;let t=new l,n=this.index.array,i=this.attributes;for(let o in i){let a=i[o],c=e(a,n);t.setAttribute(o,c)}let s=this.morphAttributes;for(let o in s){let a=[],c=s[o];for(let u=0,h=c.length;u<h;u++){let f=c[u],d=e(f,n);a.push(d)}t.morphAttributes[o]=a}t.morphTargetsRelative=this.morphTargetsRelative;let r=this.groups;for(let o=0,a=r.length;o<a;o++){let c=r[o];t.addGroup(c.start,c.count,c.materialIndex)}return t}toJSON(){let e={metadata:{version:4.7,type:"BufferGeometry",generator:"BufferGeometry.toJSON"}};if(e.uuid=this.uuid,e.type=this.type,this.name!==""&&(e.name=this.name),Object.keys(this.userData).length>0&&(e.userData=this.userData),this.parameters!==void 0){let a=this.parameters;for(let c in a)a[c]!==void 0&&(e[c]=a[c]);return e}e.data={attributes:{}};let t=this.index;t!==null&&(e.data.index={type:t.array.constructor.name,array:Array.prototype.slice.call(t.array)});let n=this.attributes;for(let a in n){let c=n[a];e.data.attributes[a]=c.toJSON(e.data)}let i={},s=!1;for(let a in this.morphAttributes){let c=this.morphAttributes[a],u=[];for(let h=0,f=c.length;h<f;h++){let d=c[h];u.push(d.toJSON(e.data))}u.length>0&&(i[a]=u,s=!0)}s&&(e.data.morphAttributes=i,e.data.morphTargetsRelative=this.morphTargetsRelative);let r=this.groups;r.length>0&&(e.data.groups=JSON.parse(JSON.stringify(r)));let o=this.boundingSphere;return o!==null&&(e.data.boundingSphere=o.toJSON()),e}clone(){return new this.constructor().copy(this)}copy(e){this.index=null,this.attributes={},this.morphAttributes={},this.groups=[],this.boundingBox=null,this.boundingSphere=null;let t={};this.name=e.name;let n=e.index;n!==null&&this.setIndex(n.clone());let i=e.attributes;for(let c in i){let u=i[c];this.setAttribute(c,u.clone(t))}let s=e.morphAttributes;for(let c in s){let u=[],h=s[c];for(let f=0,d=h.length;f<d;f++)u.push(h[f].clone(t));this.morphAttributes[c]=u}this.morphTargetsRelative=e.morphTargetsRelative;let r=e.groups;for(let c=0,u=r.length;c<u;c++){let h=r[c];this.addGroup(h.start,h.count,h.materialIndex)}let o=e.boundingBox;o!==null&&(this.boundingBox=o.clone());let a=e.boundingSphere;return a!==null&&(this.boundingSphere=a.clone()),this.drawRange.start=e.drawRange.start,this.drawRange.count=e.drawRange.count,this.userData=e.userData,this}dispose(){this.dispatchEvent({type:"dispose"})}},ca=new D,Yt=new $t,Ui=new Pe,la=new M,Ni=new M,Fi=new M,Oi=new M,js=new M,Bi=new M,ha=new M,zi=new M,we=class extends oe{constructor(e=new me,t=new ct){super(),this.isMesh=!0,this.type="Mesh",this.geometry=e,this.material=t,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.count=1,this.updateMorphTargets()}copy(e,t){return super.copy(e,t),e.morphTargetInfluences!==void 0&&(this.morphTargetInfluences=e.morphTargetInfluences.slice()),e.morphTargetDictionary!==void 0&&(this.morphTargetDictionary=Object.assign({},e.morphTargetDictionary)),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}updateMorphTargets(){let t=this.geometry.morphAttributes,n=Object.keys(t);if(n.length>0){let i=t[n[0]];if(i!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let s=0,r=i.length;s<r;s++){let o=i[s].name||String(s);this.morphTargetInfluences.push(0),this.morphTargetDictionary[o]=s}}}}getVertexPosition(e,t){let n=this.geometry,i=n.attributes.position,s=n.morphAttributes.position,r=n.morphTargetsRelative;t.fromBufferAttribute(i,e);let o=this.morphTargetInfluences;if(s&&o){Bi.set(0,0,0);for(let a=0,c=s.length;a<c;a++){let u=o[a],h=s[a];u!==0&&(js.fromBufferAttribute(h,e),r?Bi.addScaledVector(js,u):Bi.addScaledVector(js.sub(t),u))}t.add(Bi)}return t}raycast(e,t){let n=this.geometry,i=this.material,s=this.matrixWorld;i!==void 0&&(n.boundingSphere===null&&n.computeBoundingSphere(),Ui.copy(n.boundingSphere),Ui.applyMatrix4(s),Yt.copy(e.ray).recast(e.near),!(Ui.containsPoint(Yt.origin)===!1&&(Yt.intersectSphere(Ui,la)===null||Yt.origin.distanceToSquared(la)>(e.far-e.near)**2))&&(ca.copy(s).invert(),Yt.copy(e.ray).applyMatrix4(ca),!(n.boundingBox!==null&&Yt.intersectsBox(n.boundingBox)===!1)&&this._computeIntersections(e,t,Yt)))}_computeIntersections(e,t,n){let i,s=this.geometry,r=this.material,o=s.index,a=s.attributes.position,c=s.attributes.uv,u=s.attributes.uv1,h=s.attributes.normal,f=s.groups,d=s.drawRange;if(o!==null)if(Array.isArray(r))for(let p=0,g=f.length;p<g;p++){let m=f[p],x=r[m.materialIndex],v=Math.max(m.start,d.start),y=Math.min(o.count,Math.min(m.start+m.count,d.start+d.count));for(let _=v,S=y;_<S;_+=3){let T=o.getX(_),b=o.getX(_+1),w=o.getX(_+2);i=ki(this,x,e,n,c,u,h,T,b,w),i&&(i.faceIndex=Math.floor(_/3),i.face.materialIndex=m.materialIndex,t.push(i))}}else{let p=Math.max(0,d.start),g=Math.min(o.count,d.start+d.count);for(let m=p,x=g;m<x;m+=3){let v=o.getX(m),y=o.getX(m+1),_=o.getX(m+2);i=ki(this,r,e,n,c,u,h,v,y,_),i&&(i.faceIndex=Math.floor(m/3),t.push(i))}}else if(a!==void 0)if(Array.isArray(r))for(let p=0,g=f.length;p<g;p++){let m=f[p],x=r[m.materialIndex],v=Math.max(m.start,d.start),y=Math.min(a.count,Math.min(m.start+m.count,d.start+d.count));for(let _=v,S=y;_<S;_+=3){let T=_,b=_+1,w=_+2;i=ki(this,x,e,n,c,u,h,T,b,w),i&&(i.faceIndex=Math.floor(_/3),i.face.materialIndex=m.materialIndex,t.push(i))}}else{let p=Math.max(0,d.start),g=Math.min(a.count,d.start+d.count);for(let m=p,x=g;m<x;m+=3){let v=m,y=m+1,_=m+2;i=ki(this,r,e,n,c,u,h,v,y,_),i&&(i.faceIndex=Math.floor(m/3),t.push(i))}}}};function $c(l,e,t,n,i,s,r,o){let a;if(e.side===Ua?a=n.intersectTriangle(r,s,i,!0,o):a=n.intersectTriangle(i,s,r,e.side===zt,o),a===null)return null;zi.copy(o),zi.applyMatrix4(l.matrixWorld);let c=t.ray.origin.distanceTo(zi);return c<t.near||c>t.far?null:{distance:c,point:zi.clone(),object:l}}function ki(l,e,t,n,i,s,r,o,a,c){l.getVertexPosition(o,Ni),l.getVertexPosition(a,Fi),l.getVertexPosition(c,Oi);let u=$c(l,e,t,n,Ni,Fi,Oi,ha);if(u){let h=new M;Ot.getBarycoord(ha,Ni,Fi,Oi,h),i&&(u.uv=Ot.getInterpolatedAttribute(i,o,a,c,h,new Z)),s&&(u.uv1=Ot.getInterpolatedAttribute(s,o,a,c,h,new Z)),r&&(u.normal=Ot.getInterpolatedAttribute(r,o,a,c,h,new M),u.normal.dot(n.direction)>0&&u.normal.multiplyScalar(-1));let f={a:o,b:a,c,normal:new M,materialIndex:0};Ot.getNormal(Ni,Fi,Oi,f.normal),u.face=f,u.barycoord=h}return u}function ka(l){let e={};for(let t in l){e[t]={};for(let n in l[t]){let i=l[t][n];i&&(i.isColor||i.isMatrix3||i.isMatrix4||i.isVector2||i.isVector3||i.isVector4||i.isTexture||i.isQuaternion)?i.isRenderTargetTexture?(console.warn("UniformsUtils: Textures of render targets cannot be cloned via cloneUniforms() or mergeUniforms()."),e[t][n]=null):e[t][n]=i.clone():Array.isArray(i)?e[t][n]=i.slice():e[t][n]=i}}return e}function Ae(l){let e={};for(let t=0;t<l.length;t++){let n=ka(l[t]);for(let i in n)e[i]=n[i]}return e}var Qn=class extends oe{constructor(){super(),this.isCamera=!0,this.type="Camera",this.matrixWorldInverse=new D,this.projectionMatrix=new D,this.projectionMatrixInverse=new D,this.coordinateSystem=Bt,this._reversedDepth=!1}get reversedDepth(){return this._reversedDepth}copy(e,t){return super.copy(e,t),this.matrixWorldInverse.copy(e.matrixWorldInverse),this.projectionMatrix.copy(e.projectionMatrix),this.projectionMatrixInverse.copy(e.projectionMatrixInverse),this.coordinateSystem=e.coordinateSystem,this}getWorldDirection(e){return super.getWorldDirection(e).negate()}updateMatrixWorld(e){super.updateMatrixWorld(e),this.matrixWorldInverse.copy(this.matrixWorld).invert()}updateWorldMatrix(e,t){super.updateWorldMatrix(e,t),this.matrixWorldInverse.copy(this.matrixWorld).invert()}clone(){return new this.constructor().copy(this)}},Ft=new M,ua=new Z,fa=new Z,St=class extends Qn{constructor(e=50,t=1,n=.1,i=2e3){super(),this.isPerspectiveCamera=!0,this.type="PerspectiveCamera",this.fov=e,this.zoom=1,this.near=n,this.far=i,this.focus=10,this.aspect=t,this.view=null,this.filmGauge=35,this.filmOffset=0,this.updateProjectionMatrix()}copy(e,t){return super.copy(e,t),this.fov=e.fov,this.zoom=e.zoom,this.near=e.near,this.far=e.far,this.focus=e.focus,this.aspect=e.aspect,this.view=e.view===null?null:Object.assign({},e.view),this.filmGauge=e.filmGauge,this.filmOffset=e.filmOffset,this}setFocalLength(e){let t=.5*this.getFilmHeight()/e;this.fov=wn*2*Math.atan(t),this.updateProjectionMatrix()}getFocalLength(){let e=Math.tan(Jn*.5*this.fov);return .5*this.getFilmHeight()/e}getEffectiveFOV(){return wn*2*Math.atan(Math.tan(Jn*.5*this.fov)/this.zoom)}getFilmWidth(){return this.filmGauge*Math.min(this.aspect,1)}getFilmHeight(){return this.filmGauge/Math.max(this.aspect,1)}getViewBounds(e,t,n){Ft.set(-1,-1,.5).applyMatrix4(this.projectionMatrixInverse),t.set(Ft.x,Ft.y).multiplyScalar(-e/Ft.z),Ft.set(1,1,.5).applyMatrix4(this.projectionMatrixInverse),n.set(Ft.x,Ft.y).multiplyScalar(-e/Ft.z)}getViewSize(e,t){return this.getViewBounds(e,ua,fa),t.subVectors(fa,ua)}setViewOffset(e,t,n,i,s,r){this.aspect=e/t,this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=t,this.view.offsetX=n,this.view.offsetY=i,this.view.width=s,this.view.height=r,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){let e=this.near,t=e*Math.tan(Jn*.5*this.fov)/this.zoom,n=2*t,i=this.aspect*n,s=-.5*i,r=this.view;if(this.view!==null&&this.view.enabled){let a=r.fullWidth,c=r.fullHeight;s+=r.offsetX*i/a,t-=r.offsetY*n/c,i*=r.width/a,n*=r.height/c}let o=this.filmOffset;o!==0&&(s+=e*o/this.getFilmWidth()),this.projectionMatrix.makePerspective(s,s+i,t,t-n,e,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){let t=super.toJSON(e);return t.object.fov=this.fov,t.object.zoom=this.zoom,t.object.near=this.near,t.object.far=this.far,t.object.focus=this.focus,t.object.aspect=this.aspect,this.view!==null&&(t.object.view=Object.assign({},this.view)),t.object.filmGauge=this.filmGauge,t.object.filmOffset=this.filmOffset,t}};var Le=class extends oe{constructor(){super(),this.isGroup=!0,this.type="Group"}};var Cn=class extends oe{constructor(){super(),this.isScene=!0,this.type="Scene",this.background=null,this.environment=null,this.fog=null,this.backgroundBlurriness=0,this.backgroundIntensity=1,this.backgroundRotation=new _e,this.environmentIntensity=1,this.environmentRotation=new _e,this.overrideMaterial=null,typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}copy(e,t){return super.copy(e,t),e.background!==null&&(this.background=e.background.clone()),e.environment!==null&&(this.environment=e.environment.clone()),e.fog!==null&&(this.fog=e.fog.clone()),this.backgroundBlurriness=e.backgroundBlurriness,this.backgroundIntensity=e.backgroundIntensity,this.backgroundRotation.copy(e.backgroundRotation),this.environmentIntensity=e.environmentIntensity,this.environmentRotation.copy(e.environmentRotation),e.overrideMaterial!==null&&(this.overrideMaterial=e.overrideMaterial.clone()),this.matrixAutoUpdate=e.matrixAutoUpdate,this}toJSON(e){let t=super.toJSON(e);return this.fog!==null&&(t.object.fog=this.fog.toJSON()),this.backgroundBlurriness>0&&(t.object.backgroundBlurriness=this.backgroundBlurriness),this.backgroundIntensity!==1&&(t.object.backgroundIntensity=this.backgroundIntensity),t.object.backgroundRotation=this.backgroundRotation.toArray(),this.environmentIntensity!==1&&(t.object.environmentIntensity=this.environmentIntensity),t.object.environmentRotation=this.environmentRotation.toArray(),t}},In=class{constructor(e,t){this.isInterleavedBuffer=!0,this.array=e,this.stride=t,this.count=e!==void 0?e.length/t:0,this.usage=Qi,this.updateRanges=[],this.version=0,this.uuid=it()}onUploadCallback(){}set needsUpdate(e){e===!0&&this.version++}setUsage(e){return this.usage=e,this}addUpdateRange(e,t){this.updateRanges.push({start:e,count:t})}clearUpdateRanges(){this.updateRanges.length=0}copy(e){return this.array=new e.array.constructor(e.array),this.count=e.count,this.stride=e.stride,this.usage=e.usage,this}copyAt(e,t,n){e*=this.stride,n*=t.stride;for(let i=0,s=this.stride;i<s;i++)this.array[e+i]=t.array[n+i];return this}set(e,t=0){return this.array.set(e,t),this}clone(e){e.arrayBuffers===void 0&&(e.arrayBuffers={}),this.array.buffer._uuid===void 0&&(this.array.buffer._uuid=it()),e.arrayBuffers[this.array.buffer._uuid]===void 0&&(e.arrayBuffers[this.array.buffer._uuid]=this.array.slice(0).buffer);let t=new this.array.constructor(e.arrayBuffers[this.array.buffer._uuid]),n=new this.constructor(t,this.stride);return n.setUsage(this.usage),n}onUpload(e){return this.onUploadCallback=e,this}toJSON(e){return e.arrayBuffers===void 0&&(e.arrayBuffers={}),this.array.buffer._uuid===void 0&&(this.array.buffer._uuid=it()),e.arrayBuffers[this.array.buffer._uuid]===void 0&&(e.arrayBuffers[this.array.buffer._uuid]=Array.from(new Uint32Array(this.array.buffer))),{uuid:this.uuid,buffer:this.array.buffer._uuid,type:this.array.constructor.name,stride:this.stride}}},be=new M,Pn=class l{constructor(e,t,n,i=!1){this.isInterleavedBufferAttribute=!0,this.name="",this.data=e,this.itemSize=t,this.offset=n,this.normalized=i}get count(){return this.data.count}get array(){return this.data.array}set needsUpdate(e){this.data.needsUpdate=e}applyMatrix4(e){for(let t=0,n=this.data.count;t<n;t++)be.fromBufferAttribute(this,t),be.applyMatrix4(e),this.setXYZ(t,be.x,be.y,be.z);return this}applyNormalMatrix(e){for(let t=0,n=this.count;t<n;t++)be.fromBufferAttribute(this,t),be.applyNormalMatrix(e),this.setXYZ(t,be.x,be.y,be.z);return this}transformDirection(e){for(let t=0,n=this.count;t<n;t++)be.fromBufferAttribute(this,t),be.transformDirection(e),this.setXYZ(t,be.x,be.y,be.z);return this}getComponent(e,t){let n=this.array[e*this.data.stride+this.offset+t];return this.normalized&&(n=tt(n,this.array)),n}setComponent(e,t,n){return this.normalized&&(n=ie(n,this.array)),this.data.array[e*this.data.stride+this.offset+t]=n,this}setX(e,t){return this.normalized&&(t=ie(t,this.array)),this.data.array[e*this.data.stride+this.offset]=t,this}setY(e,t){return this.normalized&&(t=ie(t,this.array)),this.data.array[e*this.data.stride+this.offset+1]=t,this}setZ(e,t){return this.normalized&&(t=ie(t,this.array)),this.data.array[e*this.data.stride+this.offset+2]=t,this}setW(e,t){return this.normalized&&(t=ie(t,this.array)),this.data.array[e*this.data.stride+this.offset+3]=t,this}getX(e){let t=this.data.array[e*this.data.stride+this.offset];return this.normalized&&(t=tt(t,this.array)),t}getY(e){let t=this.data.array[e*this.data.stride+this.offset+1];return this.normalized&&(t=tt(t,this.array)),t}getZ(e){let t=this.data.array[e*this.data.stride+this.offset+2];return this.normalized&&(t=tt(t,this.array)),t}getW(e){let t=this.data.array[e*this.data.stride+this.offset+3];return this.normalized&&(t=tt(t,this.array)),t}setXY(e,t,n){return e=e*this.data.stride+this.offset,this.normalized&&(t=ie(t,this.array),n=ie(n,this.array)),this.data.array[e+0]=t,this.data.array[e+1]=n,this}setXYZ(e,t,n,i){return e=e*this.data.stride+this.offset,this.normalized&&(t=ie(t,this.array),n=ie(n,this.array),i=ie(i,this.array)),this.data.array[e+0]=t,this.data.array[e+1]=n,this.data.array[e+2]=i,this}setXYZW(e,t,n,i,s){return e=e*this.data.stride+this.offset,this.normalized&&(t=ie(t,this.array),n=ie(n,this.array),i=ie(i,this.array),s=ie(s,this.array)),this.data.array[e+0]=t,this.data.array[e+1]=n,this.data.array[e+2]=i,this.data.array[e+3]=s,this}clone(e){if(e===void 0){console.log("THREE.InterleavedBufferAttribute.clone(): Cloning an interleaved buffer attribute will de-interleave buffer data.");let t=[];for(let n=0;n<this.count;n++){let i=n*this.data.stride+this.offset;for(let s=0;s<this.itemSize;s++)t.push(this.data.array[i+s])}return new se(new this.array.constructor(t),this.itemSize,this.normalized)}else return e.interleavedBuffers===void 0&&(e.interleavedBuffers={}),e.interleavedBuffers[this.data.uuid]===void 0&&(e.interleavedBuffers[this.data.uuid]=this.data.clone(e)),new l(e.interleavedBuffers[this.data.uuid],this.itemSize,this.offset,this.normalized)}toJSON(e){if(e===void 0){console.log("THREE.InterleavedBufferAttribute.toJSON(): Serializing an interleaved buffer attribute will de-interleave buffer data.");let t=[];for(let n=0;n<this.count;n++){let i=n*this.data.stride+this.offset;for(let s=0;s<this.itemSize;s++)t.push(this.data.array[i+s])}return{itemSize:this.itemSize,type:this.array.constructor.name,array:t,normalized:this.normalized}}else return e.interleavedBuffers===void 0&&(e.interleavedBuffers={}),e.interleavedBuffers[this.data.uuid]===void 0&&(e.interleavedBuffers[this.data.uuid]=this.data.toJSON(e)),{isInterleavedBufferAttribute:!0,itemSize:this.itemSize,data:this.data.uuid,offset:this.offset,normalized:this.normalized}}};var da=new M,pa=new he,ma=new he,Qc=new M,ga=new D,Vi=new M,$s=new Pe,xa=new D,Qs=new $t,Qt=class extends we{constructor(e,t){super(e,t),this.isSkinnedMesh=!0,this.type="SkinnedMesh",this.bindMode=lr,this.bindMatrix=new D,this.bindMatrixInverse=new D,this.boundingBox=null,this.boundingSphere=null}computeBoundingBox(){let e=this.geometry;this.boundingBox===null&&(this.boundingBox=new ke),this.boundingBox.makeEmpty();let t=e.getAttribute("position");for(let n=0;n<t.count;n++)this.getVertexPosition(n,Vi),this.boundingBox.expandByPoint(Vi)}computeBoundingSphere(){let e=this.geometry;this.boundingSphere===null&&(this.boundingSphere=new Pe),this.boundingSphere.makeEmpty();let t=e.getAttribute("position");for(let n=0;n<t.count;n++)this.getVertexPosition(n,Vi),this.boundingSphere.expandByPoint(Vi)}copy(e,t){return super.copy(e,t),this.bindMode=e.bindMode,this.bindMatrix.copy(e.bindMatrix),this.bindMatrixInverse.copy(e.bindMatrixInverse),this.skeleton=e.skeleton,e.boundingBox!==null&&(this.boundingBox=e.boundingBox.clone()),e.boundingSphere!==null&&(this.boundingSphere=e.boundingSphere.clone()),this}raycast(e,t){let n=this.material,i=this.matrixWorld;n!==void 0&&(this.boundingSphere===null&&this.computeBoundingSphere(),$s.copy(this.boundingSphere),$s.applyMatrix4(i),e.ray.intersectsSphere($s)!==!1&&(xa.copy(i).invert(),Qs.copy(e.ray).applyMatrix4(xa),!(this.boundingBox!==null&&Qs.intersectsBox(this.boundingBox)===!1)&&this._computeIntersections(e,t,Qs)))}getVertexPosition(e,t){return super.getVertexPosition(e,t),this.applyBoneTransform(e,t),t}bind(e,t){this.skeleton=e,t===void 0&&(this.updateMatrixWorld(!0),this.skeleton.calculateInverses(),t=this.matrixWorld),this.bindMatrix.copy(t),this.bindMatrixInverse.copy(t).invert()}pose(){this.skeleton.pose()}normalizeSkinWeights(){let e=new he,t=this.geometry.attributes.skinWeight;for(let n=0,i=t.count;n<i;n++){e.fromBufferAttribute(t,n);let s=1/e.manhattanLength();s!==1/0?e.multiplyScalar(s):e.set(1,0,0,0),t.setXYZW(n,e.x,e.y,e.z,e.w)}}updateMatrixWorld(e){super.updateMatrixWorld(e),this.bindMode===lr?this.bindMatrixInverse.copy(this.matrixWorld).invert():this.bindMode===Na?this.bindMatrixInverse.copy(this.bindMatrix).invert():console.warn("THREE.SkinnedMesh: Unrecognized bindMode: "+this.bindMode)}applyBoneTransform(e,t){let n=this.skeleton,i=this.geometry;pa.fromBufferAttribute(i.attributes.skinIndex,e),ma.fromBufferAttribute(i.attributes.skinWeight,e),da.copy(t).applyMatrix4(this.bindMatrix),t.set(0,0,0);for(let s=0;s<4;s++){let r=ma.getComponent(s);if(r!==0){let o=pa.getComponent(s);ga.multiplyMatrices(n.bones[o].matrixWorld,n.boneInverses[o]),t.addScaledVector(Qc.copy(da).applyMatrix4(ga),r)}}return t.applyMatrix4(this.bindMatrixInverse)}},Tt=class extends oe{constructor(){super(),this.isBone=!0,this.type="Bone"}},Ln=class extends Ie{constructor(e=null,t=1,n=1,i,s,r,o,a,c=kt,u=kt,h,f){super(null,r,o,a,c,u,i,s,h,f),this.isDataTexture=!0,this.image={data:e,width:t,height:n},this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}},_a=new D,el=new D,en=class l{constructor(e=[],t=[]){this.uuid=it(),this.bones=e.slice(0),this.boneInverses=t,this.boneMatrices=null,this.boneTexture=null,this.init()}init(){let e=this.bones,t=this.boneInverses;if(this.boneMatrices=new Float32Array(e.length*16),t.length===0)this.calculateInverses();else if(e.length!==t.length){console.warn("THREE.Skeleton: Number of inverse bone matrices does not match amount of bones."),this.boneInverses=[];for(let n=0,i=this.bones.length;n<i;n++)this.boneInverses.push(new D)}}calculateInverses(){this.boneInverses.length=0;for(let e=0,t=this.bones.length;e<t;e++){let n=new D;this.bones[e]&&n.copy(this.bones[e].matrixWorld).invert(),this.boneInverses.push(n)}}pose(){for(let e=0,t=this.bones.length;e<t;e++){let n=this.bones[e];n&&n.matrixWorld.copy(this.boneInverses[e]).invert()}for(let e=0,t=this.bones.length;e<t;e++){let n=this.bones[e];n&&(n.parent&&n.parent.isBone?(n.matrix.copy(n.parent.matrixWorld).invert(),n.matrix.multiply(n.matrixWorld)):n.matrix.copy(n.matrixWorld),n.matrix.decompose(n.position,n.quaternion,n.scale))}}update(){let e=this.bones,t=this.boneInverses,n=this.boneMatrices,i=this.boneTexture;for(let s=0,r=e.length;s<r;s++){let o=e[s]?e[s].matrixWorld:el;_a.multiplyMatrices(o,t[s]),_a.toArray(n,s*16)}i!==null&&(i.needsUpdate=!0)}clone(){return new l(this.bones,this.boneInverses)}computeBoneTexture(){let e=Math.sqrt(this.bones.length*4);e=Math.ceil(e/4)*4,e=Math.max(e,4);let t=new Float32Array(e*e*4);t.set(this.boneMatrices);let n=new Ln(t,e,e,xi,ds);return n.needsUpdate=!0,this.boneMatrices=t,this.boneTexture=n,this}getBoneByName(e){for(let t=0,n=this.bones.length;t<n;t++){let i=this.bones[t];if(i.name===e)return i}}dispose(){this.boneTexture!==null&&(this.boneTexture.dispose(),this.boneTexture=null)}fromJSON(e,t){this.uuid=e.uuid;for(let n=0,i=e.bones.length;n<i;n++){let s=e.bones[n],r=t[s];r===void 0&&(console.warn("THREE.Skeleton: No bone found with UUID:",s),r=new Tt),this.bones.push(r),this.boneInverses.push(new D().fromArray(e.boneInverses[n]))}return this.init(),this}toJSON(){let e={metadata:{version:4.7,type:"Skeleton",generator:"Skeleton.toJSON"},bones:[],boneInverses:[]};e.uuid=this.uuid;let t=this.bones,n=this.boneInverses;for(let i=0,s=t.length;i<s;i++){let r=t[i];e.bones.push(r.uuid);let o=n[i];e.boneInverses.push(o.toArray())}return e}},Vt=class extends se{constructor(e,t,n,i=1){super(e,t,n),this.isInstancedBufferAttribute=!0,this.meshPerAttribute=i}copy(e){return super.copy(e),this.meshPerAttribute=e.meshPerAttribute,this}toJSON(){let e=super.toJSON();return e.meshPerAttribute=this.meshPerAttribute,e.isInstancedBufferAttribute=!0,e}},Sn=new D,ya=new D,Hi=[],va=new ke,tl=new D,Xn=new we,qn=new Pe,ei=class extends we{constructor(e,t,n){super(e,t),this.isInstancedMesh=!0,this.instanceMatrix=new Vt(new Float32Array(n*16),16),this.instanceColor=null,this.morphTexture=null,this.count=n,this.boundingBox=null,this.boundingSphere=null;for(let i=0;i<n;i++)this.setMatrixAt(i,tl)}computeBoundingBox(){let e=this.geometry,t=this.count;this.boundingBox===null&&(this.boundingBox=new ke),e.boundingBox===null&&e.computeBoundingBox(),this.boundingBox.makeEmpty();for(let n=0;n<t;n++)this.getMatrixAt(n,Sn),va.copy(e.boundingBox).applyMatrix4(Sn),this.boundingBox.union(va)}computeBoundingSphere(){let e=this.geometry,t=this.count;this.boundingSphere===null&&(this.boundingSphere=new Pe),e.boundingSphere===null&&e.computeBoundingSphere(),this.boundingSphere.makeEmpty();for(let n=0;n<t;n++)this.getMatrixAt(n,Sn),qn.copy(e.boundingSphere).applyMatrix4(Sn),this.boundingSphere.union(qn)}copy(e,t){return super.copy(e,t),this.instanceMatrix.copy(e.instanceMatrix),e.morphTexture!==null&&(this.morphTexture=e.morphTexture.clone()),e.instanceColor!==null&&(this.instanceColor=e.instanceColor.clone()),this.count=e.count,e.boundingBox!==null&&(this.boundingBox=e.boundingBox.clone()),e.boundingSphere!==null&&(this.boundingSphere=e.boundingSphere.clone()),this}getColorAt(e,t){t.fromArray(this.instanceColor.array,e*3)}getMatrixAt(e,t){t.fromArray(this.instanceMatrix.array,e*16)}getMorphAt(e,t){let n=t.morphTargetInfluences,i=this.morphTexture.source.data.data,s=n.length+1,r=e*s+1;for(let o=0;o<n.length;o++)n[o]=i[r+o]}raycast(e,t){let n=this.matrixWorld,i=this.count;if(Xn.geometry=this.geometry,Xn.material=this.material,Xn.material!==void 0&&(this.boundingSphere===null&&this.computeBoundingSphere(),qn.copy(this.boundingSphere),qn.applyMatrix4(n),e.ray.intersectsSphere(qn)!==!1))for(let s=0;s<i;s++){this.getMatrixAt(s,Sn),ya.multiplyMatrices(n,Sn),Xn.matrixWorld=ya,Xn.raycast(e,Hi);for(let r=0,o=Hi.length;r<o;r++){let a=Hi[r];a.instanceId=s,a.object=this,t.push(a)}Hi.length=0}}setColorAt(e,t){this.instanceColor===null&&(this.instanceColor=new Vt(new Float32Array(this.instanceMatrix.count*3).fill(1),3)),t.toArray(this.instanceColor.array,e*3)}setMatrixAt(e,t){t.toArray(this.instanceMatrix.array,e*16)}setMorphAt(e,t){let n=t.morphTargetInfluences,i=n.length+1;this.morphTexture===null&&(this.morphTexture=new Ln(new Float32Array(i*this.count),i,this.count,Fa,ds));let s=this.morphTexture.source.data.data,r=0;for(let c=0;c<n.length;c++)r+=n[c];let o=this.geometry.morphTargetsRelative?1:1-r,a=i*e;s[a]=o,s.set(n,a+1)}updateMorphTargets(){}dispose(){this.dispatchEvent({type:"dispose"}),this.morphTexture!==null&&(this.morphTexture.dispose(),this.morphTexture=null)}},er=new M,nl=new M,il=new k,_t=class{constructor(e=new M(1,0,0),t=0){this.isPlane=!0,this.normal=e,this.constant=t}set(e,t){return this.normal.copy(e),this.constant=t,this}setComponents(e,t,n,i){return this.normal.set(e,t,n),this.constant=i,this}setFromNormalAndCoplanarPoint(e,t){return this.normal.copy(e),this.constant=-t.dot(this.normal),this}setFromCoplanarPoints(e,t,n){let i=er.subVectors(n,t).cross(nl.subVectors(e,t)).normalize();return this.setFromNormalAndCoplanarPoint(i,e),this}copy(e){return this.normal.copy(e.normal),this.constant=e.constant,this}normalize(){let e=1/this.normal.length();return this.normal.multiplyScalar(e),this.constant*=e,this}negate(){return this.constant*=-1,this.normal.negate(),this}distanceToPoint(e){return this.normal.dot(e)+this.constant}distanceToSphere(e){return this.distanceToPoint(e.center)-e.radius}projectPoint(e,t){return t.copy(e).addScaledVector(this.normal,-this.distanceToPoint(e))}intersectLine(e,t){let n=e.delta(er),i=this.normal.dot(n);if(i===0)return this.distanceToPoint(e.start)===0?t.copy(e.start):null;let s=-(e.start.dot(this.normal)+this.constant)/i;return s<0||s>1?null:t.copy(e.start).addScaledVector(n,s)}intersectsLine(e){let t=this.distanceToPoint(e.start),n=this.distanceToPoint(e.end);return t<0&&n>0||n<0&&t>0}intersectsBox(e){return e.intersectsPlane(this)}intersectsSphere(e){return e.intersectsPlane(this)}coplanarPoint(e){return e.copy(this.normal).multiplyScalar(-this.constant)}applyMatrix4(e,t){let n=t||il.getNormalMatrix(e),i=this.coplanarPoint(er).applyMatrix4(e),s=this.normal.applyMatrix3(n).normalize();return this.constant=-i.dot(s),this}translate(e){return this.constant-=e.dot(this.normal),this}equals(e){return e.normal.equals(this.normal)&&e.constant===this.constant}clone(){return new this.constructor().copy(this)}},Kt=new Pe,sl=new Z(.5,.5),Gi=new M,ss=class{constructor(e=new _t,t=new _t,n=new _t,i=new _t,s=new _t,r=new _t){this.planes=[e,t,n,i,s,r]}set(e,t,n,i,s,r){let o=this.planes;return o[0].copy(e),o[1].copy(t),o[2].copy(n),o[3].copy(i),o[4].copy(s),o[5].copy(r),this}copy(e){let t=this.planes;for(let n=0;n<6;n++)t[n].copy(e.planes[n]);return this}setFromProjectionMatrix(e,t=Bt,n=!1){let i=this.planes,s=e.elements,r=s[0],o=s[1],a=s[2],c=s[3],u=s[4],h=s[5],f=s[6],d=s[7],p=s[8],g=s[9],m=s[10],x=s[11],v=s[12],y=s[13],_=s[14],S=s[15];if(i[0].setComponents(c-r,d-u,x-p,S-v).normalize(),i[1].setComponents(c+r,d+u,x+p,S+v).normalize(),i[2].setComponents(c+o,d+h,x+g,S+y).normalize(),i[3].setComponents(c-o,d-h,x-g,S-y).normalize(),n)i[4].setComponents(a,f,m,_).normalize(),i[5].setComponents(c-a,d-f,x-m,S-_).normalize();else if(i[4].setComponents(c-a,d-f,x-m,S-_).normalize(),t===Bt)i[5].setComponents(c+a,d+f,x+m,S+_).normalize();else if(t===es)i[5].setComponents(a,f,m,_).normalize();else throw new Error("THREE.Frustum.setFromProjectionMatrix(): Invalid coordinate system: "+t);return this}intersectsObject(e){if(e.boundingSphere!==void 0)e.boundingSphere===null&&e.computeBoundingSphere(),Kt.copy(e.boundingSphere).applyMatrix4(e.matrixWorld);else{let t=e.geometry;t.boundingSphere===null&&t.computeBoundingSphere(),Kt.copy(t.boundingSphere).applyMatrix4(e.matrixWorld)}return this.intersectsSphere(Kt)}intersectsSprite(e){Kt.center.set(0,0,0);let t=sl.distanceTo(e.center);return Kt.radius=.7071067811865476+t,Kt.applyMatrix4(e.matrixWorld),this.intersectsSphere(Kt)}intersectsSphere(e){let t=this.planes,n=e.center,i=-e.radius;for(let s=0;s<6;s++)if(t[s].distanceToPoint(n)<i)return!1;return!0}intersectsBox(e){let t=this.planes;for(let n=0;n<6;n++){let i=t[n];if(Gi.x=i.normal.x>0?e.max.x:e.min.x,Gi.y=i.normal.y>0?e.max.y:e.min.y,Gi.z=i.normal.z>0?e.max.z:e.min.z,i.distanceToPoint(Gi)<0)return!1}return!0}containsPoint(e){let t=this.planes;for(let n=0;n<6;n++)if(t[n].distanceToPoint(e)<0)return!1;return!0}clone(){return new this.constructor().copy(this)}};var Xe=class extends Te{constructor(e){super(),this.isLineBasicMaterial=!0,this.type="LineBasicMaterial",this.color=new L(16777215),this.map=null,this.linewidth=1,this.linecap="round",this.linejoin="round",this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.linewidth=e.linewidth,this.linecap=e.linecap,this.linejoin=e.linejoin,this.fog=e.fog,this}},rs=new M,os=new M,Ma=new D,Yn=new $t,Wi=new Pe,tr=new M,Sa=new M,bt=class extends oe{constructor(e=new me,t=new Xe){super(),this.isLine=!0,this.type="Line",this.geometry=e,this.material=t,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.updateMorphTargets()}copy(e,t){return super.copy(e,t),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}computeLineDistances(){let e=this.geometry;if(e.index===null){let t=e.attributes.position,n=[0];for(let i=1,s=t.count;i<s;i++)rs.fromBufferAttribute(t,i-1),os.fromBufferAttribute(t,i),n[i]=n[i-1],n[i]+=rs.distanceTo(os);e.setAttribute("lineDistance",new Q(n,1))}else console.warn("THREE.Line.computeLineDistances(): Computation only possible with non-indexed BufferGeometry.");return this}raycast(e,t){let n=this.geometry,i=this.matrixWorld,s=e.params.Line.threshold,r=n.drawRange;if(n.boundingSphere===null&&n.computeBoundingSphere(),Wi.copy(n.boundingSphere),Wi.applyMatrix4(i),Wi.radius+=s,e.ray.intersectsSphere(Wi)===!1)return;Ma.copy(i).invert(),Yn.copy(e.ray).applyMatrix4(Ma);let o=s/((this.scale.x+this.scale.y+this.scale.z)/3),a=o*o,c=this.isLineSegments?2:1,u=n.index,f=n.attributes.position;if(u!==null){let d=Math.max(0,r.start),p=Math.min(u.count,r.start+r.count);for(let g=d,m=p-1;g<m;g+=c){let x=u.getX(g),v=u.getX(g+1),y=Xi(this,e,Yn,a,x,v,g);y&&t.push(y)}if(this.isLineLoop){let g=u.getX(p-1),m=u.getX(d),x=Xi(this,e,Yn,a,g,m,p-1);x&&t.push(x)}}else{let d=Math.max(0,r.start),p=Math.min(f.count,r.start+r.count);for(let g=d,m=p-1;g<m;g+=c){let x=Xi(this,e,Yn,a,g,g+1,g);x&&t.push(x)}if(this.isLineLoop){let g=Xi(this,e,Yn,a,p-1,d,p-1);g&&t.push(g)}}}updateMorphTargets(){let t=this.geometry.morphAttributes,n=Object.keys(t);if(n.length>0){let i=t[n[0]];if(i!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let s=0,r=i.length;s<r;s++){let o=i[s].name||String(s);this.morphTargetInfluences.push(0),this.morphTargetDictionary[o]=s}}}}};function Xi(l,e,t,n,i,s,r){let o=l.geometry.attributes.position;if(rs.fromBufferAttribute(o,i),os.fromBufferAttribute(o,s),t.distanceSqToSegment(rs,os,tr,Sa)>n)return;tr.applyMatrix4(l.matrixWorld);let c=e.ray.origin.distanceTo(tr);if(!(c<e.near||c>e.far))return{distance:c,point:Sa.clone().applyMatrix4(l.matrixWorld),index:r,face:null,faceIndex:null,barycoord:null,object:l}}var Ta=new M,ba=new M,Ht=class extends bt{constructor(e,t){super(e,t),this.isLineSegments=!0,this.type="LineSegments"}computeLineDistances(){let e=this.geometry;if(e.index===null){let t=e.attributes.position,n=[];for(let i=0,s=t.count;i<s;i+=2)Ta.fromBufferAttribute(t,i),ba.fromBufferAttribute(t,i+1),n[i]=i===0?0:n[i-1],n[i+1]=n[i]+Ta.distanceTo(ba);e.setAttribute("lineDistance",new Q(n,1))}else console.warn("THREE.LineSegments.computeLineDistances(): Computation only possible with non-indexed BufferGeometry.");return this}},ti=class extends bt{constructor(e,t){super(e,t),this.isLineLoop=!0,this.type="LineLoop"}},st=class extends Te{constructor(e){super(),this.isPointsMaterial=!0,this.type="PointsMaterial",this.color=new L(16777215),this.map=null,this.alphaMap=null,this.size=1,this.sizeAttenuation=!0,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.alphaMap=e.alphaMap,this.size=e.size,this.sizeAttenuation=e.sizeAttenuation,this.fog=e.fog,this}},wa=new D,gr=new $t,qi=new Pe,Yi=new M,wt=class extends oe{constructor(e=new me,t=new st){super(),this.isPoints=!0,this.type="Points",this.geometry=e,this.material=t,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.updateMorphTargets()}copy(e,t){return super.copy(e,t),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}raycast(e,t){let n=this.geometry,i=this.matrixWorld,s=e.params.Points.threshold,r=n.drawRange;if(n.boundingSphere===null&&n.computeBoundingSphere(),qi.copy(n.boundingSphere),qi.applyMatrix4(i),qi.radius+=s,e.ray.intersectsSphere(qi)===!1)return;wa.copy(i).invert(),gr.copy(e.ray).applyMatrix4(wa);let o=s/((this.scale.x+this.scale.y+this.scale.z)/3),a=o*o,c=n.index,h=n.attributes.position;if(c!==null){let f=Math.max(0,r.start),d=Math.min(c.count,r.start+r.count);for(let p=f,g=d;p<g;p++){let m=c.getX(p);Yi.fromBufferAttribute(h,m),Aa(Yi,m,a,i,e,t,this)}}else{let f=Math.max(0,r.start),d=Math.min(h.count,r.start+r.count);for(let p=f,g=d;p<g;p++)Yi.fromBufferAttribute(h,p),Aa(Yi,p,a,i,e,t,this)}}updateMorphTargets(){let t=this.geometry.morphAttributes,n=Object.keys(t);if(n.length>0){let i=t[n[0]];if(i!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let s=0,r=i.length;s<r;s++){let o=i[s].name||String(s);this.morphTargetInfluences.push(0),this.morphTargetDictionary[o]=s}}}}};function Aa(l,e,t,n,i,s,r){let o=gr.distanceSqToPoint(l);if(o<t){let a=new M;gr.closestPointToPoint(l,a),a.applyMatrix4(n);let c=i.ray.origin.distanceTo(a);if(c<i.near||c>i.far)return;s.push({distance:c,distanceToRay:Math.sqrt(o),point:a,index:e,face:null,faceIndex:null,barycoord:null,object:r})}}var tn=class extends Ie{constructor(e,t,n,i,s,r,o,a,c,u,h,f){super(null,r,o,a,c,u,i,s,h,f),this.isCompressedTexture=!0,this.image={width:t,height:n},this.mipmaps=e,this.flipY=!1,this.generateMipmaps=!1}};var ni=class{constructor(){this.type="Curve",this.arcLengthDivisions=200,this.needsUpdate=!1,this.cacheArcLengths=null}getPoint(){console.warn("THREE.Curve: .getPoint() not implemented.")}getPointAt(e,t){let n=this.getUtoTmapping(e);return this.getPoint(n,t)}getPoints(e=5){let t=[];for(let n=0;n<=e;n++)t.push(this.getPoint(n/e));return t}getSpacedPoints(e=5){let t=[];for(let n=0;n<=e;n++)t.push(this.getPointAt(n/e));return t}getLength(){let e=this.getLengths();return e[e.length-1]}getLengths(e=this.arcLengthDivisions){if(this.cacheArcLengths&&this.cacheArcLengths.length===e+1&&!this.needsUpdate)return this.cacheArcLengths;this.needsUpdate=!1;let t=[],n,i=this.getPoint(0),s=0;t.push(0);for(let r=1;r<=e;r++)n=this.getPoint(r/e),s+=n.distanceTo(i),t.push(s),i=n;return this.cacheArcLengths=t,t}updateArcLengths(){this.needsUpdate=!0,this.getLengths()}getUtoTmapping(e,t=null){let n=this.getLengths(),i=0,s=n.length,r;t?r=t:r=e*n[s-1];let o=0,a=s-1,c;for(;o<=a;)if(i=Math.floor(o+(a-o)/2),c=n[i]-r,c<0)o=i+1;else if(c>0)a=i-1;else{a=i;break}if(i=a,n[i]===r)return i/(s-1);let u=n[i],f=n[i+1]-u,d=(r-u)/f;return(i+d)/(s-1)}getTangent(e,t){let i=e-1e-4,s=e+1e-4;i<0&&(i=0),s>1&&(s=1);let r=this.getPoint(i),o=this.getPoint(s),a=t||(r.isVector2?new Z:new M);return a.copy(o).sub(r).normalize(),a}getTangentAt(e,t){let n=this.getUtoTmapping(e);return this.getTangent(n,t)}computeFrenetFrames(e,t=!1){let n=new M,i=[],s=[],r=[],o=new M,a=new D;for(let d=0;d<=e;d++){let p=d/e;i[d]=this.getTangentAt(p,new M)}s[0]=new M,r[0]=new M;let c=Number.MAX_VALUE,u=Math.abs(i[0].x),h=Math.abs(i[0].y),f=Math.abs(i[0].z);u<=c&&(c=u,n.set(1,0,0)),h<=c&&(c=h,n.set(0,1,0)),f<=c&&n.set(0,0,1),o.crossVectors(i[0],n).normalize(),s[0].crossVectors(i[0],o),r[0].crossVectors(i[0],s[0]);for(let d=1;d<=e;d++){if(s[d]=s[d-1].clone(),r[d]=r[d-1].clone(),o.crossVectors(i[d-1],i[d]),o.length()>Number.EPSILON){o.normalize();let p=Math.acos(G(i[d-1].dot(i[d]),-1,1));s[d].applyMatrix4(a.makeRotationAxis(o,p))}r[d].crossVectors(i[d],s[d])}if(t===!0){let d=Math.acos(G(s[0].dot(s[e]),-1,1));d/=e,i[0].dot(o.crossVectors(s[0],s[e]))>0&&(d=-d);for(let p=1;p<=e;p++)s[p].applyMatrix4(a.makeRotationAxis(i[p],d*p)),r[p].crossVectors(i[p],s[p])}return{tangents:i,normals:s,binormals:r}}clone(){return new this.constructor().copy(this)}copy(e){return this.arcLengthDivisions=e.arcLengthDivisions,this}toJSON(){let e={metadata:{version:4.7,type:"Curve",generator:"Curve.toJSON"}};return e.arcLengthDivisions=this.arcLengthDivisions,e.type=this.type,e}fromJSON(e){return this.arcLengthDivisions=e.arcLengthDivisions,this}};function rl(l,e,t=2){let n=e&&e.length,i=n?e[0]*t:l.length,s=Va(l,0,i,t,!0),r=[];if(!s||s.next===s.prev)return r;let o,a,c;if(n&&(s=hl(l,e,s,t)),l.length>80*t){o=1/0,a=1/0;let u=-1/0,h=-1/0;for(let f=t;f<i;f+=t){let d=l[f],p=l[f+1];d<o&&(o=d),p<a&&(a=p),d>u&&(u=d),p>h&&(h=p)}c=Math.max(u-o,h-a),c=c!==0?32767/c:0}return ii(s,r,t,o,a,c,0),r}function Va(l,e,t,n,i){let s;if(i===Ml(l,e,t,n)>0)for(let r=e;r<t;r+=n)s=Ea(r/n|0,l[r],l[r+1],s);else for(let r=t-n;r>=e;r-=n)s=Ea(r/n|0,l[r],l[r+1],s);return s&&Dn(s,s.next)&&(ri(s),s=s.next),s}function nn(l,e){if(!l)return l;e||(e=l);let t=l,n;do if(n=!1,!t.steiner&&(Dn(t,t.next)||ue(t.prev,t,t.next)===0)){if(ri(t),t=e=t.prev,t===t.next)break;n=!0}else t=t.next;while(n||t!==e);return e}function ii(l,e,t,n,i,s,r){if(!l)return;!r&&s&&ml(l,n,i,s);let o=l;for(;l.prev!==l.next;){let a=l.prev,c=l.next;if(s?al(l,n,i,s):ol(l)){e.push(a.i,l.i,c.i),ri(l),l=c.next,o=c.next;continue}if(l=c,l===o){r?r===1?(l=cl(nn(l),e),ii(l,e,t,n,i,s,2)):r===2&&ll(l,e,t,n,i,s):ii(nn(l),e,t,n,i,s,1);break}}}function ol(l){let e=l.prev,t=l,n=l.next;if(ue(e,t,n)>=0)return!1;let i=e.x,s=t.x,r=n.x,o=e.y,a=t.y,c=n.y,u=Math.min(i,s,r),h=Math.min(o,a,c),f=Math.max(i,s,r),d=Math.max(o,a,c),p=n.next;for(;p!==e;){if(p.x>=u&&p.x<=f&&p.y>=h&&p.y<=d&&Zn(i,o,s,a,r,c,p.x,p.y)&&ue(p.prev,p,p.next)>=0)return!1;p=p.next}return!0}function al(l,e,t,n){let i=l.prev,s=l,r=l.next;if(ue(i,s,r)>=0)return!1;let o=i.x,a=s.x,c=r.x,u=i.y,h=s.y,f=r.y,d=Math.min(o,a,c),p=Math.min(u,h,f),g=Math.max(o,a,c),m=Math.max(u,h,f),x=xr(d,p,e,t,n),v=xr(g,m,e,t,n),y=l.prevZ,_=l.nextZ;for(;y&&y.z>=x&&_&&_.z<=v;){if(y.x>=d&&y.x<=g&&y.y>=p&&y.y<=m&&y!==i&&y!==r&&Zn(o,u,a,h,c,f,y.x,y.y)&&ue(y.prev,y,y.next)>=0||(y=y.prevZ,_.x>=d&&_.x<=g&&_.y>=p&&_.y<=m&&_!==i&&_!==r&&Zn(o,u,a,h,c,f,_.x,_.y)&&ue(_.prev,_,_.next)>=0))return!1;_=_.nextZ}for(;y&&y.z>=x;){if(y.x>=d&&y.x<=g&&y.y>=p&&y.y<=m&&y!==i&&y!==r&&Zn(o,u,a,h,c,f,y.x,y.y)&&ue(y.prev,y,y.next)>=0)return!1;y=y.prevZ}for(;_&&_.z<=v;){if(_.x>=d&&_.x<=g&&_.y>=p&&_.y<=m&&_!==i&&_!==r&&Zn(o,u,a,h,c,f,_.x,_.y)&&ue(_.prev,_,_.next)>=0)return!1;_=_.nextZ}return!0}function cl(l,e){let t=l;do{let n=t.prev,i=t.next.next;!Dn(n,i)&&Ga(n,t,t.next,i)&&si(n,i)&&si(i,n)&&(e.push(n.i,t.i,i.i),ri(t),ri(t.next),t=l=i),t=t.next}while(t!==l);return nn(t)}function ll(l,e,t,n,i,s){let r=l;do{let o=r.next.next;for(;o!==r.prev;){if(r.i!==o.i&&_l(r,o)){let a=Wa(r,o);r=nn(r,r.next),a=nn(a,a.next),ii(r,e,t,n,i,s,0),ii(a,e,t,n,i,s,0);return}o=o.next}r=r.next}while(r!==l)}function hl(l,e,t,n){let i=[];for(let s=0,r=e.length;s<r;s++){let o=e[s]*n,a=s<r-1?e[s+1]*n:l.length,c=Va(l,o,a,n,!1);c===c.next&&(c.steiner=!0),i.push(xl(c))}i.sort(ul);for(let s=0;s<i.length;s++)t=fl(i[s],t);return t}function ul(l,e){let t=l.x-e.x;if(t===0&&(t=l.y-e.y,t===0)){let n=(l.next.y-l.y)/(l.next.x-l.x),i=(e.next.y-e.y)/(e.next.x-e.x);t=n-i}return t}function fl(l,e){let t=dl(l,e);if(!t)return e;let n=Wa(t,l);return nn(n,n.next),nn(t,t.next)}function dl(l,e){let t=e,n=l.x,i=l.y,s=-1/0,r;if(Dn(l,t))return t;do{if(Dn(l,t.next))return t.next;if(i<=t.y&&i>=t.next.y&&t.next.y!==t.y){let h=t.x+(i-t.y)*(t.next.x-t.x)/(t.next.y-t.y);if(h<=n&&h>s&&(s=h,r=t.x<t.next.x?t:t.next,h===n))return r}t=t.next}while(t!==e);if(!r)return null;let o=r,a=r.x,c=r.y,u=1/0;t=r;do{if(n>=t.x&&t.x>=a&&n!==t.x&&Ha(i<c?n:s,i,a,c,i<c?s:n,i,t.x,t.y)){let h=Math.abs(i-t.y)/(n-t.x);si(t,l)&&(h<u||h===u&&(t.x>r.x||t.x===r.x&&pl(r,t)))&&(r=t,u=h)}t=t.next}while(t!==o);return r}function pl(l,e){return ue(l.prev,l,e.prev)<0&&ue(e.next,l,l.next)<0}function ml(l,e,t,n){let i=l;do i.z===0&&(i.z=xr(i.x,i.y,e,t,n)),i.prevZ=i.prev,i.nextZ=i.next,i=i.next;while(i!==l);i.prevZ.nextZ=null,i.prevZ=null,gl(i)}function gl(l){let e,t=1;do{let n=l,i;l=null;let s=null;for(e=0;n;){e++;let r=n,o=0;for(let c=0;c<t&&(o++,r=r.nextZ,!!r);c++);let a=t;for(;o>0||a>0&&r;)o!==0&&(a===0||!r||n.z<=r.z)?(i=n,n=n.nextZ,o--):(i=r,r=r.nextZ,a--),s?s.nextZ=i:l=i,i.prevZ=s,s=i;n=r}s.nextZ=null,t*=2}while(e>1);return l}function xr(l,e,t,n,i){return l=(l-t)*i|0,e=(e-n)*i|0,l=(l|l<<8)&16711935,l=(l|l<<4)&252645135,l=(l|l<<2)&858993459,l=(l|l<<1)&1431655765,e=(e|e<<8)&16711935,e=(e|e<<4)&252645135,e=(e|e<<2)&858993459,e=(e|e<<1)&1431655765,l|e<<1}function xl(l){let e=l,t=l;do(e.x<t.x||e.x===t.x&&e.y<t.y)&&(t=e),e=e.next;while(e!==l);return t}function Ha(l,e,t,n,i,s,r,o){return(i-r)*(e-o)>=(l-r)*(s-o)&&(l-r)*(n-o)>=(t-r)*(e-o)&&(t-r)*(s-o)>=(i-r)*(n-o)}function Zn(l,e,t,n,i,s,r,o){return!(l===r&&e===o)&&Ha(l,e,t,n,i,s,r,o)}function _l(l,e){return l.next.i!==e.i&&l.prev.i!==e.i&&!yl(l,e)&&(si(l,e)&&si(e,l)&&vl(l,e)&&(ue(l.prev,l,e.prev)||ue(l,e.prev,e))||Dn(l,e)&&ue(l.prev,l,l.next)>0&&ue(e.prev,e,e.next)>0)}function ue(l,e,t){return(e.y-l.y)*(t.x-e.x)-(e.x-l.x)*(t.y-e.y)}function Dn(l,e){return l.x===e.x&&l.y===e.y}function Ga(l,e,t,n){let i=Zi(ue(l,e,t)),s=Zi(ue(l,e,n)),r=Zi(ue(t,n,l)),o=Zi(ue(t,n,e));return!!(i!==s&&r!==o||i===0&&Ki(l,t,e)||s===0&&Ki(l,n,e)||r===0&&Ki(t,l,n)||o===0&&Ki(t,e,n))}function Ki(l,e,t){return e.x<=Math.max(l.x,t.x)&&e.x>=Math.min(l.x,t.x)&&e.y<=Math.max(l.y,t.y)&&e.y>=Math.min(l.y,t.y)}function Zi(l){return l>0?1:l<0?-1:0}function yl(l,e){let t=l;do{if(t.i!==l.i&&t.next.i!==l.i&&t.i!==e.i&&t.next.i!==e.i&&Ga(t,t.next,l,e))return!0;t=t.next}while(t!==l);return!1}function si(l,e){return ue(l.prev,l,l.next)<0?ue(l,e,l.next)>=0&&ue(l,l.prev,e)>=0:ue(l,e,l.prev)<0||ue(l,l.next,e)<0}function vl(l,e){let t=l,n=!1,i=(l.x+e.x)/2,s=(l.y+e.y)/2;do t.y>s!=t.next.y>s&&t.next.y!==t.y&&i<(t.next.x-t.x)*(s-t.y)/(t.next.y-t.y)+t.x&&(n=!n),t=t.next;while(t!==l);return n}function Wa(l,e){let t=_r(l.i,l.x,l.y),n=_r(e.i,e.x,e.y),i=l.next,s=e.prev;return l.next=e,e.prev=l,t.next=i,i.prev=t,n.next=t,t.prev=n,s.next=n,n.prev=s,n}function Ea(l,e,t,n){let i=_r(l,e,t);return n?(i.next=n.next,i.prev=n,n.next.prev=i,n.next=i):(i.prev=i,i.next=i),i}function ri(l){l.next.prev=l.prev,l.prev.next=l.next,l.prevZ&&(l.prevZ.nextZ=l.nextZ),l.nextZ&&(l.nextZ.prevZ=l.prevZ)}function _r(l,e,t){return{i:l,x:e,y:t,prev:null,next:null,z:0,prevZ:null,nextZ:null,steiner:!1}}function Ml(l,e,t,n){let i=0;for(let s=e,r=t-n;s<t;s+=n)i+=(l[r]-l[s])*(l[s+1]+l[r+1]),r=s;return i}var yr=class{static triangulate(e,t,n=2){return rl(e,t,n)}},oi=class l{static area(e){let t=e.length,n=0;for(let i=t-1,s=0;s<t;i=s++)n+=e[i].x*e[s].y-e[s].x*e[i].y;return n*.5}static isClockWise(e){return l.area(e)<0}static triangulateShape(e,t){let n=[],i=[],s=[];Ra(e),Ca(n,e);let r=e.length;t.forEach(Ra);for(let a=0;a<t.length;a++)i.push(r),r+=t[a].length,Ca(n,t[a]);let o=yr.triangulate(n,i);for(let a=0;a<o.length;a+=3)s.push(o.slice(a,a+3));return s}};function Ra(l){let e=l.length;e>2&&l[e-1].equals(l[0])&&l.pop()}function Ca(l,e){for(let t=0;t<e.length;t++)l.push(e[t].x),l.push(e[t].y)}var lt=class extends Te{constructor(e){super(),this.isMeshStandardMaterial=!0,this.type="MeshStandardMaterial",this.defines={STANDARD:""},this.color=new L(16777215),this.roughness=1,this.metalness=0,this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new L(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=ps,this.normalScale=new Z(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.roughnessMap=null,this.metalnessMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new _e,this.envMapIntensity=1,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.defines={STANDARD:""},this.color.copy(e.color),this.roughness=e.roughness,this.metalness=e.metalness,this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.emissive.copy(e.emissive),this.emissiveMap=e.emissiveMap,this.emissiveIntensity=e.emissiveIntensity,this.bumpMap=e.bumpMap,this.bumpScale=e.bumpScale,this.normalMap=e.normalMap,this.normalMapType=e.normalMapType,this.normalScale.copy(e.normalScale),this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.roughnessMap=e.roughnessMap,this.metalnessMap=e.metalnessMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.envMapIntensity=e.envMapIntensity,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.flatShading=e.flatShading,this.fog=e.fog,this}},De=class extends lt{constructor(e){super(),this.isMeshPhysicalMaterial=!0,this.defines={STANDARD:"",PHYSICAL:""},this.type="MeshPhysicalMaterial",this.anisotropyRotation=0,this.anisotropyMap=null,this.clearcoatMap=null,this.clearcoatRoughness=0,this.clearcoatRoughnessMap=null,this.clearcoatNormalScale=new Z(1,1),this.clearcoatNormalMap=null,this.ior=1.5,Object.defineProperty(this,"reflectivity",{get:function(){return G(2.5*(this.ior-1)/(this.ior+1),0,1)},set:function(t){this.ior=(1+.4*t)/(1-.4*t)}}),this.iridescenceMap=null,this.iridescenceIOR=1.3,this.iridescenceThicknessRange=[100,400],this.iridescenceThicknessMap=null,this.sheenColor=new L(0),this.sheenColorMap=null,this.sheenRoughness=1,this.sheenRoughnessMap=null,this.transmissionMap=null,this.thickness=0,this.thicknessMap=null,this.attenuationDistance=1/0,this.attenuationColor=new L(1,1,1),this.specularIntensity=1,this.specularIntensityMap=null,this.specularColor=new L(1,1,1),this.specularColorMap=null,this._anisotropy=0,this._clearcoat=0,this._dispersion=0,this._iridescence=0,this._sheen=0,this._transmission=0,this.setValues(e)}get anisotropy(){return this._anisotropy}set anisotropy(e){this._anisotropy>0!=e>0&&this.version++,this._anisotropy=e}get clearcoat(){return this._clearcoat}set clearcoat(e){this._clearcoat>0!=e>0&&this.version++,this._clearcoat=e}get iridescence(){return this._iridescence}set iridescence(e){this._iridescence>0!=e>0&&this.version++,this._iridescence=e}get dispersion(){return this._dispersion}set dispersion(e){this._dispersion>0!=e>0&&this.version++,this._dispersion=e}get sheen(){return this._sheen}set sheen(e){this._sheen>0!=e>0&&this.version++,this._sheen=e}get transmission(){return this._transmission}set transmission(e){this._transmission>0!=e>0&&this.version++,this._transmission=e}copy(e){return super.copy(e),this.defines={STANDARD:"",PHYSICAL:""},this.anisotropy=e.anisotropy,this.anisotropyRotation=e.anisotropyRotation,this.anisotropyMap=e.anisotropyMap,this.clearcoat=e.clearcoat,this.clearcoatMap=e.clearcoatMap,this.clearcoatRoughness=e.clearcoatRoughness,this.clearcoatRoughnessMap=e.clearcoatRoughnessMap,this.clearcoatNormalMap=e.clearcoatNormalMap,this.clearcoatNormalScale.copy(e.clearcoatNormalScale),this.dispersion=e.dispersion,this.ior=e.ior,this.iridescence=e.iridescence,this.iridescenceMap=e.iridescenceMap,this.iridescenceIOR=e.iridescenceIOR,this.iridescenceThicknessRange=[...e.iridescenceThicknessRange],this.iridescenceThicknessMap=e.iridescenceThicknessMap,this.sheen=e.sheen,this.sheenColor.copy(e.sheenColor),this.sheenColorMap=e.sheenColorMap,this.sheenRoughness=e.sheenRoughness,this.sheenRoughnessMap=e.sheenRoughnessMap,this.transmission=e.transmission,this.transmissionMap=e.transmissionMap,this.thickness=e.thickness,this.thicknessMap=e.thicknessMap,this.attenuationDistance=e.attenuationDistance,this.attenuationColor.copy(e.attenuationColor),this.specularIntensity=e.specularIntensity,this.specularIntensityMap=e.specularIntensityMap,this.specularColor.copy(e.specularColor),this.specularColorMap=e.specularColorMap,this}},qe=class extends Te{constructor(e){super(),this.isMeshPhongMaterial=!0,this.type="MeshPhongMaterial",this.color=new L(16777215),this.specular=new L(1118481),this.shininess=30,this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new L(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=ps,this.normalScale=new Z(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new _e,this.combine=fs,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.specular.copy(e.specular),this.shininess=e.shininess,this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.emissive.copy(e.emissive),this.emissiveMap=e.emissiveMap,this.emissiveIntensity=e.emissiveIntensity,this.bumpMap=e.bumpMap,this.bumpScale=e.bumpScale,this.normalMap=e.normalMap,this.normalMapType=e.normalMapType,this.normalScale.copy(e.normalScale),this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.specularMap=e.specularMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.combine=e.combine,this.reflectivity=e.reflectivity,this.refractionRatio=e.refractionRatio,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.flatShading=e.flatShading,this.fog=e.fog,this}};var ai=class extends Te{constructor(e){super(),this.isMeshLambertMaterial=!0,this.type="MeshLambertMaterial",this.color=new L(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new L(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=ps,this.normalScale=new Z(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new _e,this.combine=fs,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.emissive.copy(e.emissive),this.emissiveMap=e.emissiveMap,this.emissiveIntensity=e.emissiveIntensity,this.bumpMap=e.bumpMap,this.bumpScale=e.bumpScale,this.normalMap=e.normalMap,this.normalMapType=e.normalMapType,this.normalScale.copy(e.normalScale),this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.specularMap=e.specularMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.combine=e.combine,this.reflectivity=e.reflectivity,this.refractionRatio=e.refractionRatio,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.flatShading=e.flatShading,this.fog=e.fog,this}};function Ji(l,e){return!l||l.constructor===e?l:typeof e.BYTES_PER_ELEMENT=="number"?new e(l):Array.prototype.slice.call(l)}function Sl(l){return ArrayBuffer.isView(l)&&!(l instanceof DataView)}function Tl(l){function e(i,s){return l[i]-l[s]}let t=l.length,n=new Array(t);for(let i=0;i!==t;++i)n[i]=i;return n.sort(e),n}function Ia(l,e,t){let n=l.length,i=new l.constructor(n);for(let s=0,r=0;r!==n;++s){let o=t[s]*e;for(let a=0;a!==e;++a)i[r++]=l[o+a]}return i}function Xa(l,e,t,n){let i=1,s=l[0];for(;s!==void 0&&s[n]===void 0;)s=l[i++];if(s===void 0)return;let r=s[n];if(r!==void 0)if(Array.isArray(r))do r=s[n],r!==void 0&&(e.push(s.time),t.push(...r)),s=l[i++];while(s!==void 0);else if(r.toArray!==void 0)do r=s[n],r!==void 0&&(e.push(s.time),r.toArray(t,t.length)),s=l[i++];while(s!==void 0);else do r=s[n],r!==void 0&&(e.push(s.time),t.push(r)),s=l[i++];while(s!==void 0)}var At=class{constructor(e,t,n,i){this.parameterPositions=e,this._cachedIndex=0,this.resultBuffer=i!==void 0?i:new t.constructor(n),this.sampleValues=t,this.valueSize=n,this.settings=null,this.DefaultSettings_={}}evaluate(e){let t=this.parameterPositions,n=this._cachedIndex,i=t[n],s=t[n-1];e:{t:{let r;n:{i:if(!(e<i)){for(let o=n+2;;){if(i===void 0){if(e<s)break i;return n=t.length,this._cachedIndex=n,this.copySampleValue_(n-1)}if(n===o)break;if(s=i,i=t[++n],e<i)break t}r=t.length;break n}if(!(e>=s)){let o=t[1];e<o&&(n=2,s=o);for(let a=n-2;;){if(s===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(n===a)break;if(i=s,s=t[--n-1],e>=s)break t}r=n,n=0;break n}break e}for(;n<r;){let o=n+r>>>1;e<t[o]?r=o:n=o+1}if(i=t[n],s=t[n-1],s===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(i===void 0)return n=t.length,this._cachedIndex=n,this.copySampleValue_(n-1)}this._cachedIndex=n,this.intervalChanged_(n,s,i)}return this.interpolate_(n,s,e,i)}getSettings_(){return this.settings||this.DefaultSettings_}copySampleValue_(e){let t=this.resultBuffer,n=this.sampleValues,i=this.valueSize,s=e*i;for(let r=0;r!==i;++r)t[r]=n[s+r];return t}interpolate_(){throw new Error("call to abstract method")}intervalChanged_(){}},as=class extends At{constructor(e,t,n,i){super(e,t,n,i),this._weightPrev=-0,this._offsetPrev=-0,this._weightNext=-0,this._offsetNext=-0,this.DefaultSettings_={endingStart:hr,endingEnd:hr}}intervalChanged_(e,t,n){let i=this.parameterPositions,s=e-2,r=e+1,o=i[s],a=i[r];if(o===void 0)switch(this.getSettings_().endingStart){case ur:s=e,o=2*t-n;break;case fr:s=i.length-2,o=t+i[s]-i[s+1];break;default:s=e,o=n}if(a===void 0)switch(this.getSettings_().endingEnd){case ur:r=e,a=2*n-t;break;case fr:r=1,a=n+i[1]-i[0];break;default:r=e-1,a=t}let c=(n-t)*.5,u=this.valueSize;this._weightPrev=c/(t-o),this._weightNext=c/(a-n),this._offsetPrev=s*u,this._offsetNext=r*u}interpolate_(e,t,n,i){let s=this.resultBuffer,r=this.sampleValues,o=this.valueSize,a=e*o,c=a-o,u=this._offsetPrev,h=this._offsetNext,f=this._weightPrev,d=this._weightNext,p=(n-t)/(i-t),g=p*p,m=g*p,x=-f*m+2*f*g-f*p,v=(1+f)*m+(-1.5-2*f)*g+(-.5+f)*p+1,y=(-1-d)*m+(1.5+d)*g+.5*p,_=d*m-d*g;for(let S=0;S!==o;++S)s[S]=x*r[u+S]+v*r[c+S]+y*r[a+S]+_*r[h+S];return s}},cs=class extends At{constructor(e,t,n,i){super(e,t,n,i)}interpolate_(e,t,n,i){let s=this.resultBuffer,r=this.sampleValues,o=this.valueSize,a=e*o,c=a-o,u=(n-t)/(i-t),h=1-u;for(let f=0;f!==o;++f)s[f]=r[c+f]*h+r[a+f]*u;return s}},ls=class extends At{constructor(e,t,n,i){super(e,t,n,i)}interpolate_(e){return this.copySampleValue_(e-1)}},Ue=class{constructor(e,t,n,i){if(e===void 0)throw new Error("THREE.KeyframeTrack: track name is undefined");if(t===void 0||t.length===0)throw new Error("THREE.KeyframeTrack: no keyframes in track named "+e);this.name=e,this.times=Ji(t,this.TimeBufferType),this.values=Ji(n,this.ValueBufferType),this.setInterpolation(i||this.DefaultInterpolation)}static toJSON(e){let t=e.constructor,n;if(t.toJSON!==this.toJSON)n=t.toJSON(e);else{n={name:e.name,times:Ji(e.times,Array),values:Ji(e.values,Array)};let i=e.getInterpolation();i!==e.DefaultInterpolation&&(n.interpolation=i)}return n.type=e.ValueTypeName,n}InterpolantFactoryMethodDiscrete(e){return new ls(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodLinear(e){return new cs(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodSmooth(e){return new as(this.times,this.values,this.getValueSize(),e)}setInterpolation(e){let t;switch(e){case vt:t=this.InterpolantFactoryMethodDiscrete;break;case Mt:t=this.InterpolantFactoryMethodLinear;break;case ji:t=this.InterpolantFactoryMethodSmooth;break}if(t===void 0){let n="unsupported interpolation for "+this.ValueTypeName+" keyframe track named "+this.name;if(this.createInterpolant===void 0)if(e!==this.DefaultInterpolation)this.setInterpolation(this.DefaultInterpolation);else throw new Error(n);return console.warn("THREE.KeyframeTrack:",n),this}return this.createInterpolant=t,this}getInterpolation(){switch(this.createInterpolant){case this.InterpolantFactoryMethodDiscrete:return vt;case this.InterpolantFactoryMethodLinear:return Mt;case this.InterpolantFactoryMethodSmooth:return ji}}getValueSize(){return this.values.length/this.times.length}shift(e){if(e!==0){let t=this.times;for(let n=0,i=t.length;n!==i;++n)t[n]+=e}return this}scale(e){if(e!==1){let t=this.times;for(let n=0,i=t.length;n!==i;++n)t[n]*=e}return this}trim(e,t){let n=this.times,i=n.length,s=0,r=i-1;for(;s!==i&&n[s]<e;)++s;for(;r!==-1&&n[r]>t;)--r;if(++r,s!==0||r!==i){s>=r&&(r=Math.max(r,1),s=r-1);let o=this.getValueSize();this.times=n.slice(s,r),this.values=this.values.slice(s*o,r*o)}return this}validate(){let e=!0,t=this.getValueSize();t-Math.floor(t)!==0&&(console.error("THREE.KeyframeTrack: Invalid value size in track.",this),e=!1);let n=this.times,i=this.values,s=n.length;s===0&&(console.error("THREE.KeyframeTrack: Track is empty.",this),e=!1);let r=null;for(let o=0;o!==s;o++){let a=n[o];if(typeof a=="number"&&isNaN(a)){console.error("THREE.KeyframeTrack: Time is not a valid number.",this,o,a),e=!1;break}if(r!==null&&r>a){console.error("THREE.KeyframeTrack: Out of order keys.",this,o,a,r),e=!1;break}r=a}if(i!==void 0&&Sl(i))for(let o=0,a=i.length;o!==a;++o){let c=i[o];if(isNaN(c)){console.error("THREE.KeyframeTrack: Value is not a valid number.",this,o,c),e=!1;break}}return e}optimize(){let e=this.times.slice(),t=this.values.slice(),n=this.getValueSize(),i=this.getInterpolation()===ji,s=e.length-1,r=1;for(let o=1;o<s;++o){let a=!1,c=e[o],u=e[o+1];if(c!==u&&(o!==1||c!==e[0]))if(i)a=!0;else{let h=o*n,f=h-n,d=h+n;for(let p=0;p!==n;++p){let g=t[h+p];if(g!==t[f+p]||g!==t[d+p]){a=!0;break}}}if(a){if(o!==r){e[r]=e[o];let h=o*n,f=r*n;for(let d=0;d!==n;++d)t[f+d]=t[h+d]}++r}}if(s>0){e[r]=e[s];for(let o=s*n,a=r*n,c=0;c!==n;++c)t[a+c]=t[o+c];++r}return r!==e.length?(this.times=e.slice(0,r),this.values=t.slice(0,r*n)):(this.times=e,this.values=t),this}clone(){let e=this.times.slice(),t=this.values.slice(),n=this.constructor,i=new n(this.name,e,t);return i.createInterpolant=this.createInterpolant,i}};Ue.prototype.ValueTypeName="";Ue.prototype.TimeBufferType=Float32Array;Ue.prototype.ValueBufferType=Float32Array;Ue.prototype.DefaultInterpolation=Mt;var Et=class extends Ue{constructor(e,t,n){super(e,t,n)}};Et.prototype.ValueTypeName="bool";Et.prototype.ValueBufferType=Array;Et.prototype.DefaultInterpolation=vt;Et.prototype.InterpolantFactoryMethodLinear=void 0;Et.prototype.InterpolantFactoryMethodSmooth=void 0;var ci=class extends Ue{constructor(e,t,n,i){super(e,t,n,i)}};ci.prototype.ValueTypeName="color";var Ye=class extends Ue{constructor(e,t,n,i){super(e,t,n,i)}};Ye.prototype.ValueTypeName="number";var hs=class extends At{constructor(e,t,n,i){super(e,t,n,i)}interpolate_(e,t,n,i){let s=this.resultBuffer,r=this.sampleValues,o=this.valueSize,a=(n-t)/(i-t),c=e*o;for(let u=c+o;c!==u;c+=4)fe.slerpFlat(s,0,r,c-o,r,c,a);return s}},Ve=class extends Ue{constructor(e,t,n,i){super(e,t,n,i)}InterpolantFactoryMethodLinear(e){return new hs(this.times,this.values,this.getValueSize(),e)}};Ve.prototype.ValueTypeName="quaternion";Ve.prototype.InterpolantFactoryMethodSmooth=void 0;var Rt=class extends Ue{constructor(e,t,n){super(e,t,n)}};Rt.prototype.ValueTypeName="string";Rt.prototype.ValueBufferType=Array;Rt.prototype.DefaultInterpolation=vt;Rt.prototype.InterpolantFactoryMethodLinear=void 0;Rt.prototype.InterpolantFactoryMethodSmooth=void 0;var Ke=class extends Ue{constructor(e,t,n,i){super(e,t,n,i)}};Ke.prototype.ValueTypeName="vector";var sn=class{constructor(e="",t=-1,n=[],i=Oa){this.name=e,this.tracks=n,this.duration=t,this.blendMode=i,this.uuid=it(),this.userData={},this.duration<0&&this.resetDuration()}static parse(e){let t=[],n=e.tracks,i=1/(e.fps||1);for(let r=0,o=n.length;r!==o;++r)t.push(wl(n[r]).scale(i));let s=new this(e.name,e.duration,t,e.blendMode);return s.uuid=e.uuid,s.userData=JSON.parse(e.userData||"{}"),s}static toJSON(e){let t=[],n=e.tracks,i={name:e.name,duration:e.duration,tracks:t,uuid:e.uuid,blendMode:e.blendMode,userData:JSON.stringify(e.userData)};for(let s=0,r=n.length;s!==r;++s)t.push(Ue.toJSON(n[s]));return i}static CreateFromMorphTargetSequence(e,t,n,i){let s=t.length,r=[];for(let o=0;o<s;o++){let a=[],c=[];a.push((o+s-1)%s,o,(o+1)%s),c.push(0,1,0);let u=Tl(a);a=Ia(a,1,u),c=Ia(c,1,u),!i&&a[0]===0&&(a.push(s),c.push(c[0])),r.push(new Ye(".morphTargetInfluences["+t[o].name+"]",a,c).scale(1/n))}return new this(e,-1,r)}static findByName(e,t){let n=e;if(!Array.isArray(e)){let i=e;n=i.geometry&&i.geometry.animations||i.animations}for(let i=0;i<n.length;i++)if(n[i].name===t)return n[i];return null}static CreateClipsFromMorphTargetSequences(e,t,n){let i={},s=/^([\w-]*?)([\d]+)$/;for(let o=0,a=e.length;o<a;o++){let c=e[o],u=c.name.match(s);if(u&&u.length>1){let h=u[1],f=i[h];f||(i[h]=f=[]),f.push(c)}}let r=[];for(let o in i)r.push(this.CreateFromMorphTargetSequence(o,i[o],t,n));return r}static parseAnimation(e,t){if(console.warn("THREE.AnimationClip: parseAnimation() is deprecated and will be removed with r185"),!e)return console.error("THREE.AnimationClip: No animation in JSONLoader data."),null;let n=function(h,f,d,p,g){if(d.length!==0){let m=[],x=[];Xa(d,m,x,p),m.length!==0&&g.push(new h(f,m,x))}},i=[],s=e.name||"default",r=e.fps||30,o=e.blendMode,a=e.length||-1,c=e.hierarchy||[];for(let h=0;h<c.length;h++){let f=c[h].keys;if(!(!f||f.length===0))if(f[0].morphTargets){let d={},p;for(p=0;p<f.length;p++)if(f[p].morphTargets)for(let g=0;g<f[p].morphTargets.length;g++)d[f[p].morphTargets[g]]=-1;for(let g in d){let m=[],x=[];for(let v=0;v!==f[p].morphTargets.length;++v){let y=f[p];m.push(y.time),x.push(y.morphTarget===g?1:0)}i.push(new Ye(".morphTargetInfluence["+g+"]",m,x))}a=d.length*r}else{let d=".bones["+t[h].name+"]";n(Ke,d+".position",f,"pos",i),n(Ve,d+".quaternion",f,"rot",i),n(Ke,d+".scale",f,"scl",i)}}return i.length===0?null:new this(s,a,i,o)}resetDuration(){let e=this.tracks,t=0;for(let n=0,i=e.length;n!==i;++n){let s=this.tracks[n];t=Math.max(t,s.times[s.times.length-1])}return this.duration=t,this}trim(){for(let e=0;e<this.tracks.length;e++)this.tracks[e].trim(0,this.duration);return this}validate(){let e=!0;for(let t=0;t<this.tracks.length;t++)e=e&&this.tracks[t].validate();return e}optimize(){for(let e=0;e<this.tracks.length;e++)this.tracks[e].optimize();return this}clone(){let e=[];for(let n=0;n<this.tracks.length;n++)e.push(this.tracks[n].clone());let t=new this.constructor(this.name,this.duration,e,this.blendMode);return t.userData=JSON.parse(JSON.stringify(this.userData)),t}toJSON(){return this.constructor.toJSON(this)}};function bl(l){switch(l.toLowerCase()){case"scalar":case"double":case"float":case"number":case"integer":return Ye;case"vector":case"vector2":case"vector3":case"vector4":return Ke;case"color":return ci;case"quaternion":return Ve;case"bool":case"boolean":return Et;case"string":return Rt}throw new Error("THREE.KeyframeTrack: Unsupported typeName: "+l)}function wl(l){if(l.type===void 0)throw new Error("THREE.KeyframeTrack: track type undefined, can not parse");let e=bl(l.type);if(l.times===void 0){let t=[],n=[];Xa(l.keys,t,n,"value"),l.times=t,l.values=n}return e.parse!==void 0?e.parse(l):new e(l.name,l.times,l.values,l.interpolation)}var at={enabled:!1,files:{},add:function(l,e){this.enabled!==!1&&(this.files[l]=e)},get:function(l){if(this.enabled!==!1)return this.files[l]},remove:function(l){delete this.files[l]},clear:function(){this.files={}}},Un=class{constructor(e,t,n){let i=this,s=!1,r=0,o=0,a,c=[];this.onStart=void 0,this.onLoad=e,this.onProgress=t,this.onError=n,this.abortController=new AbortController,this.itemStart=function(u){o++,s===!1&&i.onStart!==void 0&&i.onStart(u,r,o),s=!0},this.itemEnd=function(u){r++,i.onProgress!==void 0&&i.onProgress(u,r,o),r===o&&(s=!1,i.onLoad!==void 0&&i.onLoad())},this.itemError=function(u){i.onError!==void 0&&i.onError(u)},this.resolveURL=function(u){return a?a(u):u},this.setURLModifier=function(u){return a=u,this},this.addHandler=function(u,h){return c.push(u,h),this},this.removeHandler=function(u){let h=c.indexOf(u);return h!==-1&&c.splice(h,2),this},this.getHandler=function(u){for(let h=0,f=c.length;h<f;h+=2){let d=c[h],p=c[h+1];if(d.global&&(d.lastIndex=0),d.test(u))return p}return null},this.abort=function(){return this.abortController.abort(),this.abortController=new AbortController,this}}},ms=new Un,de=class{constructor(e){this.manager=e!==void 0?e:ms,this.crossOrigin="anonymous",this.withCredentials=!1,this.path="",this.resourcePath="",this.requestHeader={}}load(){}loadAsync(e,t){let n=this;return new Promise(function(i,s){n.load(e,i,t,s)})}parse(){}setCrossOrigin(e){return this.crossOrigin=e,this}setWithCredentials(e){return this.withCredentials=e,this}setPath(e){return this.path=e,this}setResourcePath(e){return this.resourcePath=e,this}setRequestHeader(e){return this.requestHeader=e,this}abort(){return this}};de.DEFAULT_MATERIAL_NAME="__DEFAULT";var xt={},vr=class extends Error{constructor(e,t){super(e),this.response=t}},ve=class extends de{constructor(e){super(e),this.mimeType="",this.responseType="",this._abortController=new AbortController}load(e,t,n,i){e===void 0&&(e=""),this.path!==void 0&&(e=this.path+e),e=this.manager.resolveURL(e);let s=at.get(`file:${e}`);if(s!==void 0)return this.manager.itemStart(e),setTimeout(()=>{t&&t(s),this.manager.itemEnd(e)},0),s;if(xt[e]!==void 0){xt[e].push({onLoad:t,onProgress:n,onError:i});return}xt[e]=[],xt[e].push({onLoad:t,onProgress:n,onError:i});let r=new Request(e,{headers:new Headers(this.requestHeader),credentials:this.withCredentials?"include":"same-origin",signal:typeof AbortSignal.any=="function"?AbortSignal.any([this._abortController.signal,this.manager.abortController.signal]):this._abortController.signal}),o=this.mimeType,a=this.responseType;fetch(r).then(c=>{if(c.status===200||c.status===0){if(c.status===0&&console.warn("THREE.FileLoader: HTTP Status 0 received."),typeof ReadableStream>"u"||c.body===void 0||c.body.getReader===void 0)return c;let u=xt[e],h=c.body.getReader(),f=c.headers.get("X-File-Size")||c.headers.get("Content-Length"),d=f?parseInt(f):0,p=d!==0,g=0,m=new ReadableStream({start(x){v();function v(){h.read().then(({done:y,value:_})=>{if(y)x.close();else{g+=_.byteLength;let S=new ProgressEvent("progress",{lengthComputable:p,loaded:g,total:d});for(let T=0,b=u.length;T<b;T++){let w=u[T];w.onProgress&&w.onProgress(S)}x.enqueue(_),v()}},y=>{x.error(y)})}}});return new Response(m)}else throw new vr(`fetch for "${c.url}" responded with ${c.status}: ${c.statusText}`,c)}).then(c=>{switch(a){case"arraybuffer":return c.arrayBuffer();case"blob":return c.blob();case"document":return c.text().then(u=>new DOMParser().parseFromString(u,o));case"json":return c.json();default:if(o==="")return c.text();{let h=/charset="?([^;"\s]*)"?/i.exec(o),f=h&&h[1]?h[1].toLowerCase():void 0,d=new TextDecoder(f);return c.arrayBuffer().then(p=>d.decode(p))}}}).then(c=>{at.add(`file:${e}`,c);let u=xt[e];delete xt[e];for(let h=0,f=u.length;h<f;h++){let d=u[h];d.onLoad&&d.onLoad(c)}}).catch(c=>{let u=xt[e];if(u===void 0)throw this.manager.itemError(e),c;delete xt[e];for(let h=0,f=u.length;h<f;h++){let d=u[h];d.onError&&d.onError(c)}this.manager.itemError(e)}).finally(()=>{this.manager.itemEnd(e)}),this.manager.itemStart(e)}setResponseType(e){return this.responseType=e,this}setMimeType(e){return this.mimeType=e,this}abort(){return this._abortController.abort(),this._abortController=new AbortController,this}};var Tn=new WeakMap,us=class extends de{constructor(e){super(e)}load(e,t,n,i){this.path!==void 0&&(e=this.path+e),e=this.manager.resolveURL(e);let s=this,r=at.get(`image:${e}`);if(r!==void 0){if(r.complete===!0)s.manager.itemStart(e),setTimeout(function(){t&&t(r),s.manager.itemEnd(e)},0);else{let h=Tn.get(r);h===void 0&&(h=[],Tn.set(r,h)),h.push({onLoad:t,onError:i})}return r}let o=ts("img");function a(){u(),t&&t(this);let h=Tn.get(this)||[];for(let f=0;f<h.length;f++){let d=h[f];d.onLoad&&d.onLoad(this)}Tn.delete(this),s.manager.itemEnd(e)}function c(h){u(),i&&i(h),at.remove(`image:${e}`);let f=Tn.get(this)||[];for(let d=0;d<f.length;d++){let p=f[d];p.onError&&p.onError(h)}Tn.delete(this),s.manager.itemError(e),s.manager.itemEnd(e)}function u(){o.removeEventListener("load",a,!1),o.removeEventListener("error",c,!1)}return o.addEventListener("load",a,!1),o.addEventListener("error",c,!1),e.slice(0,5)!=="data:"&&this.crossOrigin!==void 0&&(o.crossOrigin=this.crossOrigin),at.add(`image:${e}`,o),s.manager.itemStart(e),o.src=e,o}};var li=class extends de{constructor(e){super(e)}load(e,t,n,i){let s=this,r=new Ln,o=new ve(this.manager);return o.setResponseType("arraybuffer"),o.setRequestHeader(this.requestHeader),o.setPath(this.path),o.setWithCredentials(s.withCredentials),o.load(e,function(a){let c;try{c=s.parse(a)}catch(u){if(i!==void 0)i(u);else{console.error(u);return}}c.image!==void 0?r.image=c.image:c.data!==void 0&&(r.image.width=c.width,r.image.height=c.height,r.image.data=c.data),r.wrapS=c.wrapS!==void 0?c.wrapS:Re,r.wrapT=c.wrapT!==void 0?c.wrapT:Re,r.magFilter=c.magFilter!==void 0?c.magFilter:nt,r.minFilter=c.minFilter!==void 0?c.minFilter:nt,r.anisotropy=c.anisotropy!==void 0?c.anisotropy:1,c.colorSpace!==void 0&&(r.colorSpace=c.colorSpace),c.flipY!==void 0&&(r.flipY=c.flipY),c.format!==void 0&&(r.format=c.format),c.type!==void 0&&(r.type=c.type),c.mipmaps!==void 0&&(r.mipmaps=c.mipmaps,r.minFilter=ht),c.mipmapCount===1&&(r.minFilter=nt),c.generateMipmaps!==void 0&&(r.generateMipmaps=c.generateMipmaps),r.needsUpdate=!0,t&&t(r,c)},n,i),r}},Ct=class extends de{constructor(e){super(e)}load(e,t,n,i){let s=new Ie,r=new us(this.manager);return r.setCrossOrigin(this.crossOrigin),r.setPath(this.path),r.load(e,function(o){s.image=o,s.needsUpdate=!0,t!==void 0&&t(s)},n,i),s}},rn=class extends oe{constructor(e,t=1){super(),this.isLight=!0,this.type="Light",this.color=new L(e),this.intensity=t}dispose(){}copy(e,t){return super.copy(e,t),this.color.copy(e.color),this.intensity=e.intensity,this}toJSON(e){let t=super.toJSON(e);return t.object.color=this.color.getHex(),t.object.intensity=this.intensity,this.groundColor!==void 0&&(t.object.groundColor=this.groundColor.getHex()),this.distance!==void 0&&(t.object.distance=this.distance),this.angle!==void 0&&(t.object.angle=this.angle),this.decay!==void 0&&(t.object.decay=this.decay),this.penumbra!==void 0&&(t.object.penumbra=this.penumbra),this.shadow!==void 0&&(t.object.shadow=this.shadow.toJSON()),this.target!==void 0&&(t.object.target=this.target.uuid),t}};var nr=new D,Pa=new M,La=new M,hi=class{constructor(e){this.camera=e,this.intensity=1,this.bias=0,this.normalBias=0,this.radius=1,this.blurSamples=8,this.mapSize=new Z(512,512),this.mapType=Ur,this.map=null,this.mapPass=null,this.matrix=new D,this.autoUpdate=!0,this.needsUpdate=!1,this._frustum=new ss,this._frameExtents=new Z(1,1),this._viewportCount=1,this._viewports=[new he(0,0,1,1)]}getViewportCount(){return this._viewportCount}getFrustum(){return this._frustum}updateMatrices(e){let t=this.camera,n=this.matrix;Pa.setFromMatrixPosition(e.matrixWorld),t.position.copy(Pa),La.setFromMatrixPosition(e.target.matrixWorld),t.lookAt(La),t.updateMatrixWorld(),nr.multiplyMatrices(t.projectionMatrix,t.matrixWorldInverse),this._frustum.setFromProjectionMatrix(nr,t.coordinateSystem,t.reversedDepth),t.reversedDepth?n.set(.5,0,0,.5,0,.5,0,.5,0,0,1,0,0,0,0,1):n.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1),n.multiply(nr)}getViewport(e){return this._viewports[e]}getFrameExtents(){return this._frameExtents}dispose(){this.map&&this.map.dispose(),this.mapPass&&this.mapPass.dispose()}copy(e){return this.camera=e.camera.clone(),this.intensity=e.intensity,this.bias=e.bias,this.radius=e.radius,this.autoUpdate=e.autoUpdate,this.needsUpdate=e.needsUpdate,this.normalBias=e.normalBias,this.blurSamples=e.blurSamples,this.mapSize.copy(e.mapSize),this}clone(){return new this.constructor().copy(this)}toJSON(){let e={};return this.intensity!==1&&(e.intensity=this.intensity),this.bias!==0&&(e.bias=this.bias),this.normalBias!==0&&(e.normalBias=this.normalBias),this.radius!==1&&(e.radius=this.radius),(this.mapSize.x!==512||this.mapSize.y!==512)&&(e.mapSize=this.mapSize.toArray()),e.camera=this.camera.toJSON(!1).object,delete e.camera.matrix,e}},Mr=class extends hi{constructor(){super(new St(50,1,.5,500)),this.isSpotLightShadow=!0,this.focus=1,this.aspect=1}updateMatrices(e){let t=this.camera,n=wn*2*e.angle*this.focus,i=this.mapSize.width/this.mapSize.height*this.aspect,s=e.distance||t.far;(n!==t.fov||i!==t.aspect||s!==t.far)&&(t.fov=n,t.aspect=i,t.far=s,t.updateProjectionMatrix()),super.updateMatrices(e)}copy(e){return super.copy(e),this.focus=e.focus,this}},on=class extends rn{constructor(e,t,n=0,i=Math.PI/3,s=0,r=2){super(e,t),this.isSpotLight=!0,this.type="SpotLight",this.position.copy(oe.DEFAULT_UP),this.updateMatrix(),this.target=new oe,this.distance=n,this.angle=i,this.penumbra=s,this.decay=r,this.map=null,this.shadow=new Mr}get power(){return this.intensity*Math.PI}set power(e){this.intensity=e/Math.PI}dispose(){this.shadow.dispose()}copy(e,t){return super.copy(e,t),this.distance=e.distance,this.angle=e.angle,this.penumbra=e.penumbra,this.decay=e.decay,this.target=e.target.clone(),this.shadow=e.shadow.clone(),this}},Da=new D,Kn=new M,ir=new M,Sr=class extends hi{constructor(){super(new St(90,1,.5,500)),this.isPointLightShadow=!0,this._frameExtents=new Z(4,2),this._viewportCount=6,this._viewports=[new he(2,1,1,1),new he(0,1,1,1),new he(3,1,1,1),new he(1,1,1,1),new he(3,0,1,1),new he(1,0,1,1)],this._cubeDirections=[new M(1,0,0),new M(-1,0,0),new M(0,0,1),new M(0,0,-1),new M(0,1,0),new M(0,-1,0)],this._cubeUps=[new M(0,1,0),new M(0,1,0),new M(0,1,0),new M(0,1,0),new M(0,0,1),new M(0,0,-1)]}updateMatrices(e,t=0){let n=this.camera,i=this.matrix,s=e.distance||n.far;s!==n.far&&(n.far=s,n.updateProjectionMatrix()),Kn.setFromMatrixPosition(e.matrixWorld),n.position.copy(Kn),ir.copy(n.position),ir.add(this._cubeDirections[t]),n.up.copy(this._cubeUps[t]),n.lookAt(ir),n.updateMatrixWorld(),i.makeTranslation(-Kn.x,-Kn.y,-Kn.z),Da.multiplyMatrices(n.projectionMatrix,n.matrixWorldInverse),this._frustum.setFromProjectionMatrix(Da,n.coordinateSystem,n.reversedDepth)}},Gt=class extends rn{constructor(e,t,n=0,i=2){super(e,t),this.isPointLight=!0,this.type="PointLight",this.distance=n,this.decay=i,this.shadow=new Sr}get power(){return this.intensity*4*Math.PI}set power(e){this.intensity=e/(4*Math.PI)}dispose(){this.shadow.dispose()}copy(e,t){return super.copy(e,t),this.distance=e.distance,this.decay=e.decay,this.shadow=e.shadow.clone(),this}},Nn=class extends Qn{constructor(e=-1,t=1,n=1,i=-1,s=.1,r=2e3){super(),this.isOrthographicCamera=!0,this.type="OrthographicCamera",this.zoom=1,this.view=null,this.left=e,this.right=t,this.top=n,this.bottom=i,this.near=s,this.far=r,this.updateProjectionMatrix()}copy(e,t){return super.copy(e,t),this.left=e.left,this.right=e.right,this.top=e.top,this.bottom=e.bottom,this.near=e.near,this.far=e.far,this.zoom=e.zoom,this.view=e.view===null?null:Object.assign({},e.view),this}setViewOffset(e,t,n,i,s,r){this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=t,this.view.offsetX=n,this.view.offsetY=i,this.view.width=s,this.view.height=r,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){let e=(this.right-this.left)/(2*this.zoom),t=(this.top-this.bottom)/(2*this.zoom),n=(this.right+this.left)/2,i=(this.top+this.bottom)/2,s=n-e,r=n+e,o=i+t,a=i-t;if(this.view!==null&&this.view.enabled){let c=(this.right-this.left)/this.view.fullWidth/this.zoom,u=(this.top-this.bottom)/this.view.fullHeight/this.zoom;s+=c*this.view.offsetX,r=s+c*this.view.width,o-=u*this.view.offsetY,a=o-u*this.view.height}this.projectionMatrix.makeOrthographic(s,r,o,a,this.near,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){let t=super.toJSON(e);return t.object.zoom=this.zoom,t.object.left=this.left,t.object.right=this.right,t.object.top=this.top,t.object.bottom=this.bottom,t.object.near=this.near,t.object.far=this.far,this.view!==null&&(t.object.view=Object.assign({},this.view)),t}},Tr=class extends hi{constructor(){super(new Nn(-5,5,5,-5,.5,500)),this.isDirectionalLightShadow=!0}},an=class extends rn{constructor(e,t){super(e,t),this.isDirectionalLight=!0,this.type="DirectionalLight",this.position.copy(oe.DEFAULT_UP),this.updateMatrix(),this.target=new oe,this.shadow=new Tr}dispose(){this.shadow.dispose()}copy(e){return super.copy(e),this.target=e.target.clone(),this.shadow=e.shadow.clone(),this}},ui=class extends rn{constructor(e,t){super(e,t),this.isAmbientLight=!0,this.type="AmbientLight"}};var He=class{static extractUrlBase(e){let t=e.lastIndexOf("/");return t===-1?"./":e.slice(0,t+1)}static resolveURL(e,t){return typeof e!="string"||e===""?"":(/^https?:\/\//i.test(t)&&/^\//.test(e)&&(t=t.replace(/(^https?:\/\/[^\/]+).*/i,"$1")),/^(https?:)?\/\//i.test(e)||/^data:.*,.*$/i.test(e)||/^blob:.*$/i.test(e)?e:t+e)}};var sr=new WeakMap,fi=class extends de{constructor(e){super(e),this.isImageBitmapLoader=!0,typeof createImageBitmap>"u"&&console.warn("THREE.ImageBitmapLoader: createImageBitmap() not supported."),typeof fetch>"u"&&console.warn("THREE.ImageBitmapLoader: fetch() not supported."),this.options={premultiplyAlpha:"none"},this._abortController=new AbortController}setOptions(e){return this.options=e,this}load(e,t,n,i){e===void 0&&(e=""),this.path!==void 0&&(e=this.path+e),e=this.manager.resolveURL(e);let s=this,r=at.get(`image-bitmap:${e}`);if(r!==void 0){if(s.manager.itemStart(e),r.then){r.then(c=>{if(sr.has(r)===!0)i&&i(sr.get(r)),s.manager.itemError(e),s.manager.itemEnd(e);else return t&&t(c),s.manager.itemEnd(e),c});return}return setTimeout(function(){t&&t(r),s.manager.itemEnd(e)},0),r}let o={};o.credentials=this.crossOrigin==="anonymous"?"same-origin":"include",o.headers=this.requestHeader,o.signal=typeof AbortSignal.any=="function"?AbortSignal.any([this._abortController.signal,this.manager.abortController.signal]):this._abortController.signal;let a=fetch(e,o).then(function(c){return c.blob()}).then(function(c){return createImageBitmap(c,Object.assign(s.options,{colorSpaceConversion:"none"}))}).then(function(c){return at.add(`image-bitmap:${e}`,c),t&&t(c),s.manager.itemEnd(e),c}).catch(function(c){i&&i(c),sr.set(a,c),at.remove(`image-bitmap:${e}`),s.manager.itemError(e),s.manager.itemEnd(e)});at.add(`image-bitmap:${e}`,a),s.manager.itemStart(e)}abort(){return this._abortController.abort(),this._abortController=new AbortController,this}};var Or="\\[\\]\\.:\\/",Al=new RegExp("["+Or+"]","g"),Br="[^"+Or+"]",El="[^"+Or.replace("\\.","")+"]",Rl=/((?:WC+[\/:])*)/.source.replace("WC",Br),Cl=/(WCOD+)?/.source.replace("WCOD",El),Il=/(?:\.(WC+)(?:\[(.+)\])?)?/.source.replace("WC",Br),Pl=/\.(WC+)(?:\[(.+)\])?/.source.replace("WC",Br),Ll=new RegExp("^"+Rl+Cl+Il+Pl+"$"),Dl=["material","materials","bones","map"],br=class{constructor(e,t,n){let i=n||X.parseTrackName(t);this._targetGroup=e,this._bindings=e.subscribe_(t,i)}getValue(e,t){this.bind();let n=this._targetGroup.nCachedObjects_,i=this._bindings[n];i!==void 0&&i.getValue(e,t)}setValue(e,t){let n=this._bindings;for(let i=this._targetGroup.nCachedObjects_,s=n.length;i!==s;++i)n[i].setValue(e,t)}bind(){let e=this._bindings;for(let t=this._targetGroup.nCachedObjects_,n=e.length;t!==n;++t)e[t].bind()}unbind(){let e=this._bindings;for(let t=this._targetGroup.nCachedObjects_,n=e.length;t!==n;++t)e[t].unbind()}},X=class l{constructor(e,t,n){this.path=t,this.parsedPath=n||l.parseTrackName(t),this.node=l.findNode(e,this.parsedPath.nodeName),this.rootNode=e,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}static create(e,t,n){return e&&e.isAnimationObjectGroup?new l.Composite(e,t,n):new l(e,t,n)}static sanitizeNodeName(e){return e.replace(/\s/g,"_").replace(Al,"")}static parseTrackName(e){let t=Ll.exec(e);if(t===null)throw new Error("PropertyBinding: Cannot parse trackName: "+e);let n={nodeName:t[2],objectName:t[3],objectIndex:t[4],propertyName:t[5],propertyIndex:t[6]},i=n.nodeName&&n.nodeName.lastIndexOf(".");if(i!==void 0&&i!==-1){let s=n.nodeName.substring(i+1);Dl.indexOf(s)!==-1&&(n.nodeName=n.nodeName.substring(0,i),n.objectName=s)}if(n.propertyName===null||n.propertyName.length===0)throw new Error("PropertyBinding: can not parse propertyName from trackName: "+e);return n}static findNode(e,t){if(t===void 0||t===""||t==="."||t===-1||t===e.name||t===e.uuid)return e;if(e.skeleton){let n=e.skeleton.getBoneByName(t);if(n!==void 0)return n}if(e.children){let n=function(s){for(let r=0;r<s.length;r++){let o=s[r];if(o.name===t||o.uuid===t)return o;let a=n(o.children);if(a)return a}return null},i=n(e.children);if(i)return i}return null}_getValue_unavailable(){}_setValue_unavailable(){}_getValue_direct(e,t){e[t]=this.targetObject[this.propertyName]}_getValue_array(e,t){let n=this.resolvedProperty;for(let i=0,s=n.length;i!==s;++i)e[t++]=n[i]}_getValue_arrayElement(e,t){e[t]=this.resolvedProperty[this.propertyIndex]}_getValue_toArray(e,t){this.resolvedProperty.toArray(e,t)}_setValue_direct(e,t){this.targetObject[this.propertyName]=e[t]}_setValue_direct_setNeedsUpdate(e,t){this.targetObject[this.propertyName]=e[t],this.targetObject.needsUpdate=!0}_setValue_direct_setMatrixWorldNeedsUpdate(e,t){this.targetObject[this.propertyName]=e[t],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_array(e,t){let n=this.resolvedProperty;for(let i=0,s=n.length;i!==s;++i)n[i]=e[t++]}_setValue_array_setNeedsUpdate(e,t){let n=this.resolvedProperty;for(let i=0,s=n.length;i!==s;++i)n[i]=e[t++];this.targetObject.needsUpdate=!0}_setValue_array_setMatrixWorldNeedsUpdate(e,t){let n=this.resolvedProperty;for(let i=0,s=n.length;i!==s;++i)n[i]=e[t++];this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_arrayElement(e,t){this.resolvedProperty[this.propertyIndex]=e[t]}_setValue_arrayElement_setNeedsUpdate(e,t){this.resolvedProperty[this.propertyIndex]=e[t],this.targetObject.needsUpdate=!0}_setValue_arrayElement_setMatrixWorldNeedsUpdate(e,t){this.resolvedProperty[this.propertyIndex]=e[t],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_fromArray(e,t){this.resolvedProperty.fromArray(e,t)}_setValue_fromArray_setNeedsUpdate(e,t){this.resolvedProperty.fromArray(e,t),this.targetObject.needsUpdate=!0}_setValue_fromArray_setMatrixWorldNeedsUpdate(e,t){this.resolvedProperty.fromArray(e,t),this.targetObject.matrixWorldNeedsUpdate=!0}_getValue_unbound(e,t){this.bind(),this.getValue(e,t)}_setValue_unbound(e,t){this.bind(),this.setValue(e,t)}bind(){let e=this.node,t=this.parsedPath,n=t.objectName,i=t.propertyName,s=t.propertyIndex;if(e||(e=l.findNode(this.rootNode,t.nodeName),this.node=e),this.getValue=this._getValue_unavailable,this.setValue=this._setValue_unavailable,!e){console.warn("THREE.PropertyBinding: No target node found for track: "+this.path+".");return}if(n){let c=t.objectIndex;switch(n){case"materials":if(!e.material){console.error("THREE.PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!e.material.materials){console.error("THREE.PropertyBinding: Can not bind to material.materials as node.material does not have a materials array.",this);return}e=e.material.materials;break;case"bones":if(!e.skeleton){console.error("THREE.PropertyBinding: Can not bind to bones as node does not have a skeleton.",this);return}e=e.skeleton.bones;for(let u=0;u<e.length;u++)if(e[u].name===c){c=u;break}break;case"map":if("map"in e){e=e.map;break}if(!e.material){console.error("THREE.PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!e.material.map){console.error("THREE.PropertyBinding: Can not bind to material.map as node.material does not have a map.",this);return}e=e.material.map;break;default:if(e[n]===void 0){console.error("THREE.PropertyBinding: Can not bind to objectName of node undefined.",this);return}e=e[n]}if(c!==void 0){if(e[c]===void 0){console.error("THREE.PropertyBinding: Trying to bind to objectIndex of objectName, but is undefined.",this,e);return}e=e[c]}}let r=e[i];if(r===void 0){let c=t.nodeName;console.error("THREE.PropertyBinding: Trying to update property for track: "+c+"."+i+" but it wasn't found.",e);return}let o=this.Versioning.None;this.targetObject=e,e.isMaterial===!0?o=this.Versioning.NeedsUpdate:e.isObject3D===!0&&(o=this.Versioning.MatrixWorldNeedsUpdate);let a=this.BindingType.Direct;if(s!==void 0){if(i==="morphTargetInfluences"){if(!e.geometry){console.error("THREE.PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.",this);return}if(!e.geometry.morphAttributes){console.error("THREE.PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.morphAttributes.",this);return}e.morphTargetDictionary[s]!==void 0&&(s=e.morphTargetDictionary[s])}a=this.BindingType.ArrayElement,this.resolvedProperty=r,this.propertyIndex=s}else r.fromArray!==void 0&&r.toArray!==void 0?(a=this.BindingType.HasFromToArray,this.resolvedProperty=r):Array.isArray(r)?(a=this.BindingType.EntireArray,this.resolvedProperty=r):this.propertyName=i;this.getValue=this.GetterByBindingType[a],this.setValue=this.SetterByBindingTypeAndVersioning[a][o]}unbind(){this.node=null,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}};X.Composite=br;X.prototype.BindingType={Direct:0,EntireArray:1,ArrayElement:2,HasFromToArray:3};X.prototype.Versioning={None:0,NeedsUpdate:1,MatrixWorldNeedsUpdate:2};X.prototype.GetterByBindingType=[X.prototype._getValue_direct,X.prototype._getValue_array,X.prototype._getValue_arrayElement,X.prototype._getValue_toArray];X.prototype.SetterByBindingTypeAndVersioning=[[X.prototype._setValue_direct,X.prototype._setValue_direct_setNeedsUpdate,X.prototype._setValue_direct_setMatrixWorldNeedsUpdate],[X.prototype._setValue_array,X.prototype._setValue_array_setNeedsUpdate,X.prototype._setValue_array_setMatrixWorldNeedsUpdate],[X.prototype._setValue_arrayElement,X.prototype._setValue_arrayElement_setNeedsUpdate,X.prototype._setValue_arrayElement_setMatrixWorldNeedsUpdate],[X.prototype._setValue_fromArray,X.prototype._setValue_fromArray_setNeedsUpdate,X.prototype._setValue_fromArray_setMatrixWorldNeedsUpdate]];var fd=new Float32Array(1);typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("register",{detail:{revision:"180"}}));typeof window<"u"&&(window.__THREE__?console.warn("WARNING: Multiple instances of Three.js being imported."):window.__THREE__="180");/**
 * @license
 * Copyright 2010-2025 Three.js Authors
 * SPDX-License-Identifier: MIT
 */var Ul=`#ifdef USE_ALPHAHASH
	if ( diffuseColor.a < getAlphaHashThreshold( vPosition ) ) discard;
#endif`,Nl=`#ifdef USE_ALPHAHASH
	const float ALPHA_HASH_SCALE = 0.05;
	float hash2D( vec2 value ) {
		return fract( 1.0e4 * sin( 17.0 * value.x + 0.1 * value.y ) * ( 0.1 + abs( sin( 13.0 * value.y + value.x ) ) ) );
	}
	float hash3D( vec3 value ) {
		return hash2D( vec2( hash2D( value.xy ), value.z ) );
	}
	float getAlphaHashThreshold( vec3 position ) {
		float maxDeriv = max(
			length( dFdx( position.xyz ) ),
			length( dFdy( position.xyz ) )
		);
		float pixScale = 1.0 / ( ALPHA_HASH_SCALE * maxDeriv );
		vec2 pixScales = vec2(
			exp2( floor( log2( pixScale ) ) ),
			exp2( ceil( log2( pixScale ) ) )
		);
		vec2 alpha = vec2(
			hash3D( floor( pixScales.x * position.xyz ) ),
			hash3D( floor( pixScales.y * position.xyz ) )
		);
		float lerpFactor = fract( log2( pixScale ) );
		float x = ( 1.0 - lerpFactor ) * alpha.x + lerpFactor * alpha.y;
		float a = min( lerpFactor, 1.0 - lerpFactor );
		vec3 cases = vec3(
			x * x / ( 2.0 * a * ( 1.0 - a ) ),
			( x - 0.5 * a ) / ( 1.0 - a ),
			1.0 - ( ( 1.0 - x ) * ( 1.0 - x ) / ( 2.0 * a * ( 1.0 - a ) ) )
		);
		float threshold = ( x < ( 1.0 - a ) )
			? ( ( x < a ) ? cases.x : cases.y )
			: cases.z;
		return clamp( threshold , 1.0e-6, 1.0 );
	}
#endif`,Fl=`#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g;
#endif`,Ol=`#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,Bl=`#ifdef USE_ALPHATEST
	#ifdef ALPHA_TO_COVERAGE
	diffuseColor.a = smoothstep( alphaTest, alphaTest + fwidth( diffuseColor.a ), diffuseColor.a );
	if ( diffuseColor.a == 0.0 ) discard;
	#else
	if ( diffuseColor.a < alphaTest ) discard;
	#endif
#endif`,zl=`#ifdef USE_ALPHATEST
	uniform float alphaTest;
#endif`,kl=`#ifdef USE_AOMAP
	float ambientOcclusion = ( texture2D( aoMap, vAoMapUv ).r - 1.0 ) * aoMapIntensity + 1.0;
	reflectedLight.indirectDiffuse *= ambientOcclusion;
	#if defined( USE_CLEARCOAT ) 
		clearcoatSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_SHEEN ) 
		sheenSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD )
		float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
		reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
	#endif
#endif`,Vl=`#ifdef USE_AOMAP
	uniform sampler2D aoMap;
	uniform float aoMapIntensity;
#endif`,Hl=`#ifdef USE_BATCHING
	#if ! defined( GL_ANGLE_multi_draw )
	#define gl_DrawID _gl_DrawID
	uniform int _gl_DrawID;
	#endif
	uniform highp sampler2D batchingTexture;
	uniform highp usampler2D batchingIdTexture;
	mat4 getBatchingMatrix( const in float i ) {
		int size = textureSize( batchingTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( batchingTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( batchingTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( batchingTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( batchingTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
	float getIndirectIndex( const in int i ) {
		int size = textureSize( batchingIdTexture, 0 ).x;
		int x = i % size;
		int y = i / size;
		return float( texelFetch( batchingIdTexture, ivec2( x, y ), 0 ).r );
	}
#endif
#ifdef USE_BATCHING_COLOR
	uniform sampler2D batchingColorTexture;
	vec3 getBatchingColor( const in float i ) {
		int size = textureSize( batchingColorTexture, 0 ).x;
		int j = int( i );
		int x = j % size;
		int y = j / size;
		return texelFetch( batchingColorTexture, ivec2( x, y ), 0 ).rgb;
	}
#endif`,Gl=`#ifdef USE_BATCHING
	mat4 batchingMatrix = getBatchingMatrix( getIndirectIndex( gl_DrawID ) );
#endif`,Wl=`vec3 transformed = vec3( position );
#ifdef USE_ALPHAHASH
	vPosition = vec3( position );
#endif`,Xl=`vec3 objectNormal = vec3( normal );
#ifdef USE_TANGENT
	vec3 objectTangent = vec3( tangent.xyz );
#endif`,ql=`float G_BlinnPhong_Implicit( ) {
	return 0.25;
}
float D_BlinnPhong( const in float shininess, const in float dotNH ) {
	return RECIPROCAL_PI * ( shininess * 0.5 + 1.0 ) * pow( dotNH, shininess );
}
vec3 BRDF_BlinnPhong( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in vec3 specularColor, const in float shininess ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( specularColor, 1.0, dotVH );
	float G = G_BlinnPhong_Implicit( );
	float D = D_BlinnPhong( shininess, dotNH );
	return F * ( G * D );
} // validated`,Yl=`#ifdef USE_IRIDESCENCE
	const mat3 XYZ_TO_REC709 = mat3(
		 3.2404542, -0.9692660,  0.0556434,
		-1.5371385,  1.8760108, -0.2040259,
		-0.4985314,  0.0415560,  1.0572252
	);
	vec3 Fresnel0ToIor( vec3 fresnel0 ) {
		vec3 sqrtF0 = sqrt( fresnel0 );
		return ( vec3( 1.0 ) + sqrtF0 ) / ( vec3( 1.0 ) - sqrtF0 );
	}
	vec3 IorToFresnel0( vec3 transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - vec3( incidentIor ) ) / ( transmittedIor + vec3( incidentIor ) ) );
	}
	float IorToFresnel0( float transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - incidentIor ) / ( transmittedIor + incidentIor ));
	}
	vec3 evalSensitivity( float OPD, vec3 shift ) {
		float phase = 2.0 * PI * OPD * 1.0e-9;
		vec3 val = vec3( 5.4856e-13, 4.4201e-13, 5.2481e-13 );
		vec3 pos = vec3( 1.6810e+06, 1.7953e+06, 2.2084e+06 );
		vec3 var = vec3( 4.3278e+09, 9.3046e+09, 6.6121e+09 );
		vec3 xyz = val * sqrt( 2.0 * PI * var ) * cos( pos * phase + shift ) * exp( - pow2( phase ) * var );
		xyz.x += 9.7470e-14 * sqrt( 2.0 * PI * 4.5282e+09 ) * cos( 2.2399e+06 * phase + shift[ 0 ] ) * exp( - 4.5282e+09 * pow2( phase ) );
		xyz /= 1.0685e-7;
		vec3 rgb = XYZ_TO_REC709 * xyz;
		return rgb;
	}
	vec3 evalIridescence( float outsideIOR, float eta2, float cosTheta1, float thinFilmThickness, vec3 baseF0 ) {
		vec3 I;
		float iridescenceIOR = mix( outsideIOR, eta2, smoothstep( 0.0, 0.03, thinFilmThickness ) );
		float sinTheta2Sq = pow2( outsideIOR / iridescenceIOR ) * ( 1.0 - pow2( cosTheta1 ) );
		float cosTheta2Sq = 1.0 - sinTheta2Sq;
		if ( cosTheta2Sq < 0.0 ) {
			return vec3( 1.0 );
		}
		float cosTheta2 = sqrt( cosTheta2Sq );
		float R0 = IorToFresnel0( iridescenceIOR, outsideIOR );
		float R12 = F_Schlick( R0, 1.0, cosTheta1 );
		float T121 = 1.0 - R12;
		float phi12 = 0.0;
		if ( iridescenceIOR < outsideIOR ) phi12 = PI;
		float phi21 = PI - phi12;
		vec3 baseIOR = Fresnel0ToIor( clamp( baseF0, 0.0, 0.9999 ) );		vec3 R1 = IorToFresnel0( baseIOR, iridescenceIOR );
		vec3 R23 = F_Schlick( R1, 1.0, cosTheta2 );
		vec3 phi23 = vec3( 0.0 );
		if ( baseIOR[ 0 ] < iridescenceIOR ) phi23[ 0 ] = PI;
		if ( baseIOR[ 1 ] < iridescenceIOR ) phi23[ 1 ] = PI;
		if ( baseIOR[ 2 ] < iridescenceIOR ) phi23[ 2 ] = PI;
		float OPD = 2.0 * iridescenceIOR * thinFilmThickness * cosTheta2;
		vec3 phi = vec3( phi21 ) + phi23;
		vec3 R123 = clamp( R12 * R23, 1e-5, 0.9999 );
		vec3 r123 = sqrt( R123 );
		vec3 Rs = pow2( T121 ) * R23 / ( vec3( 1.0 ) - R123 );
		vec3 C0 = R12 + Rs;
		I = C0;
		vec3 Cm = Rs - T121;
		for ( int m = 1; m <= 2; ++ m ) {
			Cm *= r123;
			vec3 Sm = 2.0 * evalSensitivity( float( m ) * OPD, float( m ) * phi );
			I += Cm * Sm;
		}
		return max( I, vec3( 0.0 ) );
	}
#endif`,Kl=`#ifdef USE_BUMPMAP
	uniform sampler2D bumpMap;
	uniform float bumpScale;
	vec2 dHdxy_fwd() {
		vec2 dSTdx = dFdx( vBumpMapUv );
		vec2 dSTdy = dFdy( vBumpMapUv );
		float Hll = bumpScale * texture2D( bumpMap, vBumpMapUv ).x;
		float dBx = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdx ).x - Hll;
		float dBy = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdy ).x - Hll;
		return vec2( dBx, dBy );
	}
	vec3 perturbNormalArb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection ) {
		vec3 vSigmaX = normalize( dFdx( surf_pos.xyz ) );
		vec3 vSigmaY = normalize( dFdy( surf_pos.xyz ) );
		vec3 vN = surf_norm;
		vec3 R1 = cross( vSigmaY, vN );
		vec3 R2 = cross( vN, vSigmaX );
		float fDet = dot( vSigmaX, R1 ) * faceDirection;
		vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
		return normalize( abs( fDet ) * surf_norm - vGrad );
	}
#endif`,Zl=`#if NUM_CLIPPING_PLANES > 0
	vec4 plane;
	#ifdef ALPHA_TO_COVERAGE
		float distanceToPlane, distanceGradient;
		float clipOpacity = 1.0;
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
			distanceGradient = fwidth( distanceToPlane ) / 2.0;
			clipOpacity *= smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			if ( clipOpacity == 0.0 ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			float unionClipOpacity = 1.0;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
				distanceGradient = fwidth( distanceToPlane ) / 2.0;
				unionClipOpacity *= 1.0 - smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			}
			#pragma unroll_loop_end
			clipOpacity *= 1.0 - unionClipOpacity;
		#endif
		diffuseColor.a *= clipOpacity;
		if ( diffuseColor.a == 0.0 ) discard;
	#else
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			if ( dot( vClipPosition, plane.xyz ) > plane.w ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			bool clipped = true;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				clipped = ( dot( vClipPosition, plane.xyz ) > plane.w ) && clipped;
			}
			#pragma unroll_loop_end
			if ( clipped ) discard;
		#endif
	#endif
#endif`,Jl=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
	uniform vec4 clippingPlanes[ NUM_CLIPPING_PLANES ];
#endif`,jl=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
#endif`,$l=`#if NUM_CLIPPING_PLANES > 0
	vClipPosition = - mvPosition.xyz;
#endif`,Ql=`#if defined( USE_COLOR_ALPHA )
	diffuseColor *= vColor;
#elif defined( USE_COLOR )
	diffuseColor.rgb *= vColor;
#endif`,eh=`#if defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#elif defined( USE_COLOR )
	varying vec3 vColor;
#endif`,th=`#if defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#elif defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	varying vec3 vColor;
#endif`,nh=`#if defined( USE_COLOR_ALPHA )
	vColor = vec4( 1.0 );
#elif defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	vColor = vec3( 1.0 );
#endif
#ifdef USE_COLOR
	vColor *= color;
#endif
#ifdef USE_INSTANCING_COLOR
	vColor.xyz *= instanceColor.xyz;
#endif
#ifdef USE_BATCHING_COLOR
	vec3 batchingColor = getBatchingColor( getIndirectIndex( gl_DrawID ) );
	vColor.xyz *= batchingColor.xyz;
#endif`,ih=`#define PI 3.141592653589793
#define PI2 6.283185307179586
#define PI_HALF 1.5707963267948966
#define RECIPROCAL_PI 0.3183098861837907
#define RECIPROCAL_PI2 0.15915494309189535
#define EPSILON 1e-6
#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
#define whiteComplement( a ) ( 1.0 - saturate( a ) )
float pow2( const in float x ) { return x*x; }
vec3 pow2( const in vec3 x ) { return x*x; }
float pow3( const in float x ) { return x*x*x; }
float pow4( const in float x ) { float x2 = x*x; return x2*x2; }
float max3( const in vec3 v ) { return max( max( v.x, v.y ), v.z ); }
float average( const in vec3 v ) { return dot( v, vec3( 0.3333333 ) ); }
highp float rand( const in vec2 uv ) {
	const highp float a = 12.9898, b = 78.233, c = 43758.5453;
	highp float dt = dot( uv.xy, vec2( a,b ) ), sn = mod( dt, PI );
	return fract( sin( sn ) * c );
}
#ifdef HIGH_PRECISION
	float precisionSafeLength( vec3 v ) { return length( v ); }
#else
	float precisionSafeLength( vec3 v ) {
		float maxComponent = max3( abs( v ) );
		return length( v / maxComponent ) * maxComponent;
	}
#endif
struct IncidentLight {
	vec3 color;
	vec3 direction;
	bool visible;
};
struct ReflectedLight {
	vec3 directDiffuse;
	vec3 directSpecular;
	vec3 indirectDiffuse;
	vec3 indirectSpecular;
};
#ifdef USE_ALPHAHASH
	varying vec3 vPosition;
#endif
vec3 transformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );
}
vec3 inverseTransformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( vec4( dir, 0.0 ) * matrix ).xyz );
}
mat3 transposeMat3( const in mat3 m ) {
	mat3 tmp;
	tmp[ 0 ] = vec3( m[ 0 ].x, m[ 1 ].x, m[ 2 ].x );
	tmp[ 1 ] = vec3( m[ 0 ].y, m[ 1 ].y, m[ 2 ].y );
	tmp[ 2 ] = vec3( m[ 0 ].z, m[ 1 ].z, m[ 2 ].z );
	return tmp;
}
bool isPerspectiveMatrix( mat4 m ) {
	return m[ 2 ][ 3 ] == - 1.0;
}
vec2 equirectUv( in vec3 dir ) {
	float u = atan( dir.z, dir.x ) * RECIPROCAL_PI2 + 0.5;
	float v = asin( clamp( dir.y, - 1.0, 1.0 ) ) * RECIPROCAL_PI + 0.5;
	return vec2( u, v );
}
vec3 BRDF_Lambert( const in vec3 diffuseColor ) {
	return RECIPROCAL_PI * diffuseColor;
}
vec3 F_Schlick( const in vec3 f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
}
float F_Schlick( const in float f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
} // validated`,sh=`#ifdef ENVMAP_TYPE_CUBE_UV
	#define cubeUV_minMipLevel 4.0
	#define cubeUV_minTileSize 16.0
	float getFace( vec3 direction ) {
		vec3 absDirection = abs( direction );
		float face = - 1.0;
		if ( absDirection.x > absDirection.z ) {
			if ( absDirection.x > absDirection.y )
				face = direction.x > 0.0 ? 0.0 : 3.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		} else {
			if ( absDirection.z > absDirection.y )
				face = direction.z > 0.0 ? 2.0 : 5.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		}
		return face;
	}
	vec2 getUV( vec3 direction, float face ) {
		vec2 uv;
		if ( face == 0.0 ) {
			uv = vec2( direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 1.0 ) {
			uv = vec2( - direction.x, - direction.z ) / abs( direction.y );
		} else if ( face == 2.0 ) {
			uv = vec2( - direction.x, direction.y ) / abs( direction.z );
		} else if ( face == 3.0 ) {
			uv = vec2( - direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 4.0 ) {
			uv = vec2( - direction.x, direction.z ) / abs( direction.y );
		} else {
			uv = vec2( direction.x, direction.y ) / abs( direction.z );
		}
		return 0.5 * ( uv + 1.0 );
	}
	vec3 bilinearCubeUV( sampler2D envMap, vec3 direction, float mipInt ) {
		float face = getFace( direction );
		float filterInt = max( cubeUV_minMipLevel - mipInt, 0.0 );
		mipInt = max( mipInt, cubeUV_minMipLevel );
		float faceSize = exp2( mipInt );
		highp vec2 uv = getUV( direction, face ) * ( faceSize - 2.0 ) + 1.0;
		if ( face > 2.0 ) {
			uv.y += faceSize;
			face -= 3.0;
		}
		uv.x += face * faceSize;
		uv.x += filterInt * 3.0 * cubeUV_minTileSize;
		uv.y += 4.0 * ( exp2( CUBEUV_MAX_MIP ) - faceSize );
		uv.x *= CUBEUV_TEXEL_WIDTH;
		uv.y *= CUBEUV_TEXEL_HEIGHT;
		#ifdef texture2DGradEXT
			return texture2DGradEXT( envMap, uv, vec2( 0.0 ), vec2( 0.0 ) ).rgb;
		#else
			return texture2D( envMap, uv ).rgb;
		#endif
	}
	#define cubeUV_r0 1.0
	#define cubeUV_m0 - 2.0
	#define cubeUV_r1 0.8
	#define cubeUV_m1 - 1.0
	#define cubeUV_r4 0.4
	#define cubeUV_m4 2.0
	#define cubeUV_r5 0.305
	#define cubeUV_m5 3.0
	#define cubeUV_r6 0.21
	#define cubeUV_m6 4.0
	float roughnessToMip( float roughness ) {
		float mip = 0.0;
		if ( roughness >= cubeUV_r1 ) {
			mip = ( cubeUV_r0 - roughness ) * ( cubeUV_m1 - cubeUV_m0 ) / ( cubeUV_r0 - cubeUV_r1 ) + cubeUV_m0;
		} else if ( roughness >= cubeUV_r4 ) {
			mip = ( cubeUV_r1 - roughness ) * ( cubeUV_m4 - cubeUV_m1 ) / ( cubeUV_r1 - cubeUV_r4 ) + cubeUV_m1;
		} else if ( roughness >= cubeUV_r5 ) {
			mip = ( cubeUV_r4 - roughness ) * ( cubeUV_m5 - cubeUV_m4 ) / ( cubeUV_r4 - cubeUV_r5 ) + cubeUV_m4;
		} else if ( roughness >= cubeUV_r6 ) {
			mip = ( cubeUV_r5 - roughness ) * ( cubeUV_m6 - cubeUV_m5 ) / ( cubeUV_r5 - cubeUV_r6 ) + cubeUV_m5;
		} else {
			mip = - 2.0 * log2( 1.16 * roughness );		}
		return mip;
	}
	vec4 textureCubeUV( sampler2D envMap, vec3 sampleDir, float roughness ) {
		float mip = clamp( roughnessToMip( roughness ), cubeUV_m0, CUBEUV_MAX_MIP );
		float mipF = fract( mip );
		float mipInt = floor( mip );
		vec3 color0 = bilinearCubeUV( envMap, sampleDir, mipInt );
		if ( mipF == 0.0 ) {
			return vec4( color0, 1.0 );
		} else {
			vec3 color1 = bilinearCubeUV( envMap, sampleDir, mipInt + 1.0 );
			return vec4( mix( color0, color1, mipF ), 1.0 );
		}
	}
#endif`,rh=`vec3 transformedNormal = objectNormal;
#ifdef USE_TANGENT
	vec3 transformedTangent = objectTangent;
#endif
#ifdef USE_BATCHING
	mat3 bm = mat3( batchingMatrix );
	transformedNormal /= vec3( dot( bm[ 0 ], bm[ 0 ] ), dot( bm[ 1 ], bm[ 1 ] ), dot( bm[ 2 ], bm[ 2 ] ) );
	transformedNormal = bm * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = bm * transformedTangent;
	#endif
#endif
#ifdef USE_INSTANCING
	mat3 im = mat3( instanceMatrix );
	transformedNormal /= vec3( dot( im[ 0 ], im[ 0 ] ), dot( im[ 1 ], im[ 1 ] ), dot( im[ 2 ], im[ 2 ] ) );
	transformedNormal = im * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = im * transformedTangent;
	#endif
#endif
transformedNormal = normalMatrix * transformedNormal;
#ifdef FLIP_SIDED
	transformedNormal = - transformedNormal;
#endif
#ifdef USE_TANGENT
	transformedTangent = ( modelViewMatrix * vec4( transformedTangent, 0.0 ) ).xyz;
	#ifdef FLIP_SIDED
		transformedTangent = - transformedTangent;
	#endif
#endif`,oh=`#ifdef USE_DISPLACEMENTMAP
	uniform sampler2D displacementMap;
	uniform float displacementScale;
	uniform float displacementBias;
#endif`,ah=`#ifdef USE_DISPLACEMENTMAP
	transformed += normalize( objectNormal ) * ( texture2D( displacementMap, vDisplacementMapUv ).x * displacementScale + displacementBias );
#endif`,ch=`#ifdef USE_EMISSIVEMAP
	vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
	#ifdef DECODE_VIDEO_TEXTURE_EMISSIVE
		emissiveColor = sRGBTransferEOTF( emissiveColor );
	#endif
	totalEmissiveRadiance *= emissiveColor.rgb;
#endif`,lh=`#ifdef USE_EMISSIVEMAP
	uniform sampler2D emissiveMap;
#endif`,hh="gl_FragColor = linearToOutputTexel( gl_FragColor );",uh=`vec4 LinearTransferOETF( in vec4 value ) {
	return value;
}
vec4 sRGBTransferEOTF( in vec4 value ) {
	return vec4( mix( pow( value.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), value.rgb * 0.0773993808, vec3( lessThanEqual( value.rgb, vec3( 0.04045 ) ) ) ), value.a );
}
vec4 sRGBTransferOETF( in vec4 value ) {
	return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}`,fh=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vec3 cameraToFrag;
		if ( isOrthographic ) {
			cameraToFrag = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToFrag = normalize( vWorldPosition - cameraPosition );
		}
		vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vec3 reflectVec = reflect( cameraToFrag, worldNormal );
		#else
			vec3 reflectVec = refract( cameraToFrag, worldNormal, refractionRatio );
		#endif
	#else
		vec3 reflectVec = vReflect;
	#endif
	#ifdef ENVMAP_TYPE_CUBE
		vec4 envColor = textureCube( envMap, envMapRotation * vec3( flipEnvMap * reflectVec.x, reflectVec.yz ) );
	#else
		vec4 envColor = vec4( 0.0 );
	#endif
	#ifdef ENVMAP_BLENDING_MULTIPLY
		outgoingLight = mix( outgoingLight, outgoingLight * envColor.xyz, specularStrength * reflectivity );
	#elif defined( ENVMAP_BLENDING_MIX )
		outgoingLight = mix( outgoingLight, envColor.xyz, specularStrength * reflectivity );
	#elif defined( ENVMAP_BLENDING_ADD )
		outgoingLight += envColor.xyz * specularStrength * reflectivity;
	#endif
#endif`,dh=`#ifdef USE_ENVMAP
	uniform float envMapIntensity;
	uniform float flipEnvMap;
	uniform mat3 envMapRotation;
	#ifdef ENVMAP_TYPE_CUBE
		uniform samplerCube envMap;
	#else
		uniform sampler2D envMap;
	#endif
	
#endif`,ph=`#ifdef USE_ENVMAP
	uniform float reflectivity;
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		varying vec3 vWorldPosition;
		uniform float refractionRatio;
	#else
		varying vec3 vReflect;
	#endif
#endif`,mh=`#ifdef USE_ENVMAP
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		
		varying vec3 vWorldPosition;
	#else
		varying vec3 vReflect;
		uniform float refractionRatio;
	#endif
#endif`,gh=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vWorldPosition = worldPosition.xyz;
	#else
		vec3 cameraToVertex;
		if ( isOrthographic ) {
			cameraToVertex = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToVertex = normalize( worldPosition.xyz - cameraPosition );
		}
		vec3 worldNormal = inverseTransformDirection( transformedNormal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vReflect = reflect( cameraToVertex, worldNormal );
		#else
			vReflect = refract( cameraToVertex, worldNormal, refractionRatio );
		#endif
	#endif
#endif`,xh=`#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
#endif`,_h=`#ifdef USE_FOG
	varying float vFogDepth;
#endif`,yh=`#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`,vh=`#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`,Mh=`#ifdef USE_GRADIENTMAP
	uniform sampler2D gradientMap;
#endif
vec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {
	float dotNL = dot( normal, lightDirection );
	vec2 coord = vec2( dotNL * 0.5 + 0.5, 0.0 );
	#ifdef USE_GRADIENTMAP
		return vec3( texture2D( gradientMap, coord ).r );
	#else
		vec2 fw = fwidth( coord ) * 0.5;
		return mix( vec3( 0.7 ), vec3( 1.0 ), smoothstep( 0.7 - fw.x, 0.7 + fw.x, coord.x ) );
	#endif
}`,Sh=`#ifdef USE_LIGHTMAP
	uniform sampler2D lightMap;
	uniform float lightMapIntensity;
#endif`,Th=`LambertMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularStrength = specularStrength;`,bh=`varying vec3 vViewPosition;
struct LambertMaterial {
	vec3 diffuseColor;
	float specularStrength;
};
void RE_Direct_Lambert( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Lambert( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Lambert
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Lambert`,wh=`uniform bool receiveShadow;
uniform vec3 ambientLightColor;
#if defined( USE_LIGHT_PROBES )
	uniform vec3 lightProbe[ 9 ];
#endif
vec3 shGetIrradianceAt( in vec3 normal, in vec3 shCoefficients[ 9 ] ) {
	float x = normal.x, y = normal.y, z = normal.z;
	vec3 result = shCoefficients[ 0 ] * 0.886227;
	result += shCoefficients[ 1 ] * 2.0 * 0.511664 * y;
	result += shCoefficients[ 2 ] * 2.0 * 0.511664 * z;
	result += shCoefficients[ 3 ] * 2.0 * 0.511664 * x;
	result += shCoefficients[ 4 ] * 2.0 * 0.429043 * x * y;
	result += shCoefficients[ 5 ] * 2.0 * 0.429043 * y * z;
	result += shCoefficients[ 6 ] * ( 0.743125 * z * z - 0.247708 );
	result += shCoefficients[ 7 ] * 2.0 * 0.429043 * x * z;
	result += shCoefficients[ 8 ] * 0.429043 * ( x * x - y * y );
	return result;
}
vec3 getLightProbeIrradiance( const in vec3 lightProbe[ 9 ], const in vec3 normal ) {
	vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
	vec3 irradiance = shGetIrradianceAt( worldNormal, lightProbe );
	return irradiance;
}
vec3 getAmbientLightIrradiance( const in vec3 ambientLightColor ) {
	vec3 irradiance = ambientLightColor;
	return irradiance;
}
float getDistanceAttenuation( const in float lightDistance, const in float cutoffDistance, const in float decayExponent ) {
	float distanceFalloff = 1.0 / max( pow( lightDistance, decayExponent ), 0.01 );
	if ( cutoffDistance > 0.0 ) {
		distanceFalloff *= pow2( saturate( 1.0 - pow4( lightDistance / cutoffDistance ) ) );
	}
	return distanceFalloff;
}
float getSpotAttenuation( const in float coneCosine, const in float penumbraCosine, const in float angleCosine ) {
	return smoothstep( coneCosine, penumbraCosine, angleCosine );
}
#if NUM_DIR_LIGHTS > 0
	struct DirectionalLight {
		vec3 direction;
		vec3 color;
	};
	uniform DirectionalLight directionalLights[ NUM_DIR_LIGHTS ];
	void getDirectionalLightInfo( const in DirectionalLight directionalLight, out IncidentLight light ) {
		light.color = directionalLight.color;
		light.direction = directionalLight.direction;
		light.visible = true;
	}
#endif
#if NUM_POINT_LIGHTS > 0
	struct PointLight {
		vec3 position;
		vec3 color;
		float distance;
		float decay;
	};
	uniform PointLight pointLights[ NUM_POINT_LIGHTS ];
	void getPointLightInfo( const in PointLight pointLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = pointLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float lightDistance = length( lVector );
		light.color = pointLight.color;
		light.color *= getDistanceAttenuation( lightDistance, pointLight.distance, pointLight.decay );
		light.visible = ( light.color != vec3( 0.0 ) );
	}
#endif
#if NUM_SPOT_LIGHTS > 0
	struct SpotLight {
		vec3 position;
		vec3 direction;
		vec3 color;
		float distance;
		float decay;
		float coneCos;
		float penumbraCos;
	};
	uniform SpotLight spotLights[ NUM_SPOT_LIGHTS ];
	void getSpotLightInfo( const in SpotLight spotLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = spotLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float angleCos = dot( light.direction, spotLight.direction );
		float spotAttenuation = getSpotAttenuation( spotLight.coneCos, spotLight.penumbraCos, angleCos );
		if ( spotAttenuation > 0.0 ) {
			float lightDistance = length( lVector );
			light.color = spotLight.color * spotAttenuation;
			light.color *= getDistanceAttenuation( lightDistance, spotLight.distance, spotLight.decay );
			light.visible = ( light.color != vec3( 0.0 ) );
		} else {
			light.color = vec3( 0.0 );
			light.visible = false;
		}
	}
#endif
#if NUM_RECT_AREA_LIGHTS > 0
	struct RectAreaLight {
		vec3 color;
		vec3 position;
		vec3 halfWidth;
		vec3 halfHeight;
	};
	uniform sampler2D ltc_1;	uniform sampler2D ltc_2;
	uniform RectAreaLight rectAreaLights[ NUM_RECT_AREA_LIGHTS ];
#endif
#if NUM_HEMI_LIGHTS > 0
	struct HemisphereLight {
		vec3 direction;
		vec3 skyColor;
		vec3 groundColor;
	};
	uniform HemisphereLight hemisphereLights[ NUM_HEMI_LIGHTS ];
	vec3 getHemisphereLightIrradiance( const in HemisphereLight hemiLight, const in vec3 normal ) {
		float dotNL = dot( normal, hemiLight.direction );
		float hemiDiffuseWeight = 0.5 * dotNL + 0.5;
		vec3 irradiance = mix( hemiLight.groundColor, hemiLight.skyColor, hemiDiffuseWeight );
		return irradiance;
	}
#endif`,Ah=`#ifdef USE_ENVMAP
	vec3 getIBLIrradiance( const in vec3 normal ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * worldNormal, 1.0 );
			return PI * envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	vec3 getIBLRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 reflectVec = reflect( - viewDir, normal );
			reflectVec = normalize( mix( reflectVec, normal, roughness * roughness) );
			reflectVec = inverseTransformDirection( reflectVec, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * reflectVec, roughness );
			return envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	#ifdef USE_ANISOTROPY
		vec3 getIBLAnisotropyRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness, const in vec3 bitangent, const in float anisotropy ) {
			#ifdef ENVMAP_TYPE_CUBE_UV
				vec3 bentNormal = cross( bitangent, viewDir );
				bentNormal = normalize( cross( bentNormal, bitangent ) );
				bentNormal = normalize( mix( bentNormal, normal, pow2( pow2( 1.0 - anisotropy * ( 1.0 - roughness ) ) ) ) );
				return getIBLRadiance( viewDir, bentNormal, roughness );
			#else
				return vec3( 0.0 );
			#endif
		}
	#endif
#endif`,Eh=`ToonMaterial material;
material.diffuseColor = diffuseColor.rgb;`,Rh=`varying vec3 vViewPosition;
struct ToonMaterial {
	vec3 diffuseColor;
};
void RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	vec3 irradiance = getGradientIrradiance( geometryNormal, directLight.direction ) * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Toon( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Toon
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Toon`,Ch=`BlinnPhongMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularColor = specular;
material.specularShininess = shininess;
material.specularStrength = specularStrength;`,Ih=`varying vec3 vViewPosition;
struct BlinnPhongMaterial {
	vec3 diffuseColor;
	vec3 specularColor;
	float specularShininess;
	float specularStrength;
};
void RE_Direct_BlinnPhong( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
	reflectedLight.directSpecular += irradiance * BRDF_BlinnPhong( directLight.direction, geometryViewDir, geometryNormal, material.specularColor, material.specularShininess ) * material.specularStrength;
}
void RE_IndirectDiffuse_BlinnPhong( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_BlinnPhong
#define RE_IndirectDiffuse		RE_IndirectDiffuse_BlinnPhong`,Ph=`PhysicalMaterial material;
material.diffuseColor = diffuseColor.rgb * ( 1.0 - metalnessFactor );
vec3 dxy = max( abs( dFdx( nonPerturbedNormal ) ), abs( dFdy( nonPerturbedNormal ) ) );
float geometryRoughness = max( max( dxy.x, dxy.y ), dxy.z );
material.roughness = max( roughnessFactor, 0.0525 );material.roughness += geometryRoughness;
material.roughness = min( material.roughness, 1.0 );
#ifdef IOR
	material.ior = ior;
	#ifdef USE_SPECULAR
		float specularIntensityFactor = specularIntensity;
		vec3 specularColorFactor = specularColor;
		#ifdef USE_SPECULAR_COLORMAP
			specularColorFactor *= texture2D( specularColorMap, vSpecularColorMapUv ).rgb;
		#endif
		#ifdef USE_SPECULAR_INTENSITYMAP
			specularIntensityFactor *= texture2D( specularIntensityMap, vSpecularIntensityMapUv ).a;
		#endif
		material.specularF90 = mix( specularIntensityFactor, 1.0, metalnessFactor );
	#else
		float specularIntensityFactor = 1.0;
		vec3 specularColorFactor = vec3( 1.0 );
		material.specularF90 = 1.0;
	#endif
	material.specularColor = mix( min( pow2( ( material.ior - 1.0 ) / ( material.ior + 1.0 ) ) * specularColorFactor, vec3( 1.0 ) ) * specularIntensityFactor, diffuseColor.rgb, metalnessFactor );
#else
	material.specularColor = mix( vec3( 0.04 ), diffuseColor.rgb, metalnessFactor );
	material.specularF90 = 1.0;
#endif
#ifdef USE_CLEARCOAT
	material.clearcoat = clearcoat;
	material.clearcoatRoughness = clearcoatRoughness;
	material.clearcoatF0 = vec3( 0.04 );
	material.clearcoatF90 = 1.0;
	#ifdef USE_CLEARCOATMAP
		material.clearcoat *= texture2D( clearcoatMap, vClearcoatMapUv ).x;
	#endif
	#ifdef USE_CLEARCOAT_ROUGHNESSMAP
		material.clearcoatRoughness *= texture2D( clearcoatRoughnessMap, vClearcoatRoughnessMapUv ).y;
	#endif
	material.clearcoat = saturate( material.clearcoat );	material.clearcoatRoughness = max( material.clearcoatRoughness, 0.0525 );
	material.clearcoatRoughness += geometryRoughness;
	material.clearcoatRoughness = min( material.clearcoatRoughness, 1.0 );
#endif
#ifdef USE_DISPERSION
	material.dispersion = dispersion;
#endif
#ifdef USE_IRIDESCENCE
	material.iridescence = iridescence;
	material.iridescenceIOR = iridescenceIOR;
	#ifdef USE_IRIDESCENCEMAP
		material.iridescence *= texture2D( iridescenceMap, vIridescenceMapUv ).r;
	#endif
	#ifdef USE_IRIDESCENCE_THICKNESSMAP
		material.iridescenceThickness = (iridescenceThicknessMaximum - iridescenceThicknessMinimum) * texture2D( iridescenceThicknessMap, vIridescenceThicknessMapUv ).g + iridescenceThicknessMinimum;
	#else
		material.iridescenceThickness = iridescenceThicknessMaximum;
	#endif
#endif
#ifdef USE_SHEEN
	material.sheenColor = sheenColor;
	#ifdef USE_SHEEN_COLORMAP
		material.sheenColor *= texture2D( sheenColorMap, vSheenColorMapUv ).rgb;
	#endif
	material.sheenRoughness = clamp( sheenRoughness, 0.07, 1.0 );
	#ifdef USE_SHEEN_ROUGHNESSMAP
		material.sheenRoughness *= texture2D( sheenRoughnessMap, vSheenRoughnessMapUv ).a;
	#endif
#endif
#ifdef USE_ANISOTROPY
	#ifdef USE_ANISOTROPYMAP
		mat2 anisotropyMat = mat2( anisotropyVector.x, anisotropyVector.y, - anisotropyVector.y, anisotropyVector.x );
		vec3 anisotropyPolar = texture2D( anisotropyMap, vAnisotropyMapUv ).rgb;
		vec2 anisotropyV = anisotropyMat * normalize( 2.0 * anisotropyPolar.rg - vec2( 1.0 ) ) * anisotropyPolar.b;
	#else
		vec2 anisotropyV = anisotropyVector;
	#endif
	material.anisotropy = length( anisotropyV );
	if( material.anisotropy == 0.0 ) {
		anisotropyV = vec2( 1.0, 0.0 );
	} else {
		anisotropyV /= material.anisotropy;
		material.anisotropy = saturate( material.anisotropy );
	}
	material.alphaT = mix( pow2( material.roughness ), 1.0, pow2( material.anisotropy ) );
	material.anisotropyT = tbn[ 0 ] * anisotropyV.x + tbn[ 1 ] * anisotropyV.y;
	material.anisotropyB = tbn[ 1 ] * anisotropyV.x - tbn[ 0 ] * anisotropyV.y;
#endif`,Lh=`struct PhysicalMaterial {
	vec3 diffuseColor;
	float roughness;
	vec3 specularColor;
	float specularF90;
	float dispersion;
	#ifdef USE_CLEARCOAT
		float clearcoat;
		float clearcoatRoughness;
		vec3 clearcoatF0;
		float clearcoatF90;
	#endif
	#ifdef USE_IRIDESCENCE
		float iridescence;
		float iridescenceIOR;
		float iridescenceThickness;
		vec3 iridescenceFresnel;
		vec3 iridescenceF0;
	#endif
	#ifdef USE_SHEEN
		vec3 sheenColor;
		float sheenRoughness;
	#endif
	#ifdef IOR
		float ior;
	#endif
	#ifdef USE_TRANSMISSION
		float transmission;
		float transmissionAlpha;
		float thickness;
		float attenuationDistance;
		vec3 attenuationColor;
	#endif
	#ifdef USE_ANISOTROPY
		float anisotropy;
		float alphaT;
		vec3 anisotropyT;
		vec3 anisotropyB;
	#endif
};
vec3 clearcoatSpecularDirect = vec3( 0.0 );
vec3 clearcoatSpecularIndirect = vec3( 0.0 );
vec3 sheenSpecularDirect = vec3( 0.0 );
vec3 sheenSpecularIndirect = vec3(0.0 );
vec3 Schlick_to_F0( const in vec3 f, const in float f90, const in float dotVH ) {
    float x = clamp( 1.0 - dotVH, 0.0, 1.0 );
    float x2 = x * x;
    float x5 = clamp( x * x2 * x2, 0.0, 0.9999 );
    return ( f - vec3( f90 ) * x5 ) / ( 1.0 - x5 );
}
float V_GGX_SmithCorrelated( const in float alpha, const in float dotNL, const in float dotNV ) {
	float a2 = pow2( alpha );
	float gv = dotNL * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNV ) );
	float gl = dotNV * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNL ) );
	return 0.5 / max( gv + gl, EPSILON );
}
float D_GGX( const in float alpha, const in float dotNH ) {
	float a2 = pow2( alpha );
	float denom = pow2( dotNH ) * ( a2 - 1.0 ) + 1.0;
	return RECIPROCAL_PI * a2 / pow2( denom );
}
#ifdef USE_ANISOTROPY
	float V_GGX_SmithCorrelated_Anisotropic( const in float alphaT, const in float alphaB, const in float dotTV, const in float dotBV, const in float dotTL, const in float dotBL, const in float dotNV, const in float dotNL ) {
		float gv = dotNL * length( vec3( alphaT * dotTV, alphaB * dotBV, dotNV ) );
		float gl = dotNV * length( vec3( alphaT * dotTL, alphaB * dotBL, dotNL ) );
		float v = 0.5 / ( gv + gl );
		return saturate(v);
	}
	float D_GGX_Anisotropic( const in float alphaT, const in float alphaB, const in float dotNH, const in float dotTH, const in float dotBH ) {
		float a2 = alphaT * alphaB;
		highp vec3 v = vec3( alphaB * dotTH, alphaT * dotBH, a2 * dotNH );
		highp float v2 = dot( v, v );
		float w2 = a2 / v2;
		return RECIPROCAL_PI * a2 * pow2 ( w2 );
	}
#endif
#ifdef USE_CLEARCOAT
	vec3 BRDF_GGX_Clearcoat( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material) {
		vec3 f0 = material.clearcoatF0;
		float f90 = material.clearcoatF90;
		float roughness = material.clearcoatRoughness;
		float alpha = pow2( roughness );
		vec3 halfDir = normalize( lightDir + viewDir );
		float dotNL = saturate( dot( normal, lightDir ) );
		float dotNV = saturate( dot( normal, viewDir ) );
		float dotNH = saturate( dot( normal, halfDir ) );
		float dotVH = saturate( dot( viewDir, halfDir ) );
		vec3 F = F_Schlick( f0, f90, dotVH );
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
		return F * ( V * D );
	}
#endif
vec3 BRDF_GGX( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material ) {
	vec3 f0 = material.specularColor;
	float f90 = material.specularF90;
	float roughness = material.roughness;
	float alpha = pow2( roughness );
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( f0, f90, dotVH );
	#ifdef USE_IRIDESCENCE
		F = mix( F, material.iridescenceFresnel, material.iridescence );
	#endif
	#ifdef USE_ANISOTROPY
		float dotTL = dot( material.anisotropyT, lightDir );
		float dotTV = dot( material.anisotropyT, viewDir );
		float dotTH = dot( material.anisotropyT, halfDir );
		float dotBL = dot( material.anisotropyB, lightDir );
		float dotBV = dot( material.anisotropyB, viewDir );
		float dotBH = dot( material.anisotropyB, halfDir );
		float V = V_GGX_SmithCorrelated_Anisotropic( material.alphaT, alpha, dotTV, dotBV, dotTL, dotBL, dotNV, dotNL );
		float D = D_GGX_Anisotropic( material.alphaT, alpha, dotNH, dotTH, dotBH );
	#else
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
	#endif
	return F * ( V * D );
}
vec2 LTC_Uv( const in vec3 N, const in vec3 V, const in float roughness ) {
	const float LUT_SIZE = 64.0;
	const float LUT_SCALE = ( LUT_SIZE - 1.0 ) / LUT_SIZE;
	const float LUT_BIAS = 0.5 / LUT_SIZE;
	float dotNV = saturate( dot( N, V ) );
	vec2 uv = vec2( roughness, sqrt( 1.0 - dotNV ) );
	uv = uv * LUT_SCALE + LUT_BIAS;
	return uv;
}
float LTC_ClippedSphereFormFactor( const in vec3 f ) {
	float l = length( f );
	return max( ( l * l + f.z ) / ( l + 1.0 ), 0.0 );
}
vec3 LTC_EdgeVectorFormFactor( const in vec3 v1, const in vec3 v2 ) {
	float x = dot( v1, v2 );
	float y = abs( x );
	float a = 0.8543985 + ( 0.4965155 + 0.0145206 * y ) * y;
	float b = 3.4175940 + ( 4.1616724 + y ) * y;
	float v = a / b;
	float theta_sintheta = ( x > 0.0 ) ? v : 0.5 * inversesqrt( max( 1.0 - x * x, 1e-7 ) ) - v;
	return cross( v1, v2 ) * theta_sintheta;
}
vec3 LTC_Evaluate( const in vec3 N, const in vec3 V, const in vec3 P, const in mat3 mInv, const in vec3 rectCoords[ 4 ] ) {
	vec3 v1 = rectCoords[ 1 ] - rectCoords[ 0 ];
	vec3 v2 = rectCoords[ 3 ] - rectCoords[ 0 ];
	vec3 lightNormal = cross( v1, v2 );
	if( dot( lightNormal, P - rectCoords[ 0 ] ) < 0.0 ) return vec3( 0.0 );
	vec3 T1, T2;
	T1 = normalize( V - N * dot( V, N ) );
	T2 = - cross( N, T1 );
	mat3 mat = mInv * transposeMat3( mat3( T1, T2, N ) );
	vec3 coords[ 4 ];
	coords[ 0 ] = mat * ( rectCoords[ 0 ] - P );
	coords[ 1 ] = mat * ( rectCoords[ 1 ] - P );
	coords[ 2 ] = mat * ( rectCoords[ 2 ] - P );
	coords[ 3 ] = mat * ( rectCoords[ 3 ] - P );
	coords[ 0 ] = normalize( coords[ 0 ] );
	coords[ 1 ] = normalize( coords[ 1 ] );
	coords[ 2 ] = normalize( coords[ 2 ] );
	coords[ 3 ] = normalize( coords[ 3 ] );
	vec3 vectorFormFactor = vec3( 0.0 );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 0 ], coords[ 1 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 1 ], coords[ 2 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 2 ], coords[ 3 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 3 ], coords[ 0 ] );
	float result = LTC_ClippedSphereFormFactor( vectorFormFactor );
	return vec3( result );
}
#if defined( USE_SHEEN )
float D_Charlie( float roughness, float dotNH ) {
	float alpha = pow2( roughness );
	float invAlpha = 1.0 / alpha;
	float cos2h = dotNH * dotNH;
	float sin2h = max( 1.0 - cos2h, 0.0078125 );
	return ( 2.0 + invAlpha ) * pow( sin2h, invAlpha * 0.5 ) / ( 2.0 * PI );
}
float V_Neubelt( float dotNV, float dotNL ) {
	return saturate( 1.0 / ( 4.0 * ( dotNL + dotNV - dotNL * dotNV ) ) );
}
vec3 BRDF_Sheen( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, vec3 sheenColor, const in float sheenRoughness ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float D = D_Charlie( sheenRoughness, dotNH );
	float V = V_Neubelt( dotNV, dotNL );
	return sheenColor * ( D * V );
}
#endif
float IBLSheenBRDF( const in vec3 normal, const in vec3 viewDir, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	float r2 = roughness * roughness;
	float a = roughness < 0.25 ? -339.2 * r2 + 161.4 * roughness - 25.9 : -8.48 * r2 + 14.3 * roughness - 9.95;
	float b = roughness < 0.25 ? 44.0 * r2 - 23.7 * roughness + 3.26 : 1.97 * r2 - 3.27 * roughness + 0.72;
	float DG = exp( a * dotNV + b ) + ( roughness < 0.25 ? 0.0 : 0.1 * ( roughness - 0.25 ) );
	return saturate( DG * RECIPROCAL_PI );
}
vec2 DFGApprox( const in vec3 normal, const in vec3 viewDir, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	const vec4 c0 = vec4( - 1, - 0.0275, - 0.572, 0.022 );
	const vec4 c1 = vec4( 1, 0.0425, 1.04, - 0.04 );
	vec4 r = roughness * c0 + c1;
	float a004 = min( r.x * r.x, exp2( - 9.28 * dotNV ) ) * r.x + r.y;
	vec2 fab = vec2( - 1.04, 1.04 ) * a004 + r.zw;
	return fab;
}
vec3 EnvironmentBRDF( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness ) {
	vec2 fab = DFGApprox( normal, viewDir, roughness );
	return specularColor * fab.x + specularF90 * fab.y;
}
#ifdef USE_IRIDESCENCE
void computeMultiscatteringIridescence( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float iridescence, const in vec3 iridescenceF0, const in float roughness, inout vec3 singleScatter, inout vec3 multiScatter ) {
#else
void computeMultiscattering( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness, inout vec3 singleScatter, inout vec3 multiScatter ) {
#endif
	vec2 fab = DFGApprox( normal, viewDir, roughness );
	#ifdef USE_IRIDESCENCE
		vec3 Fr = mix( specularColor, iridescenceF0, iridescence );
	#else
		vec3 Fr = specularColor;
	#endif
	vec3 FssEss = Fr * fab.x + specularF90 * fab.y;
	float Ess = fab.x + fab.y;
	float Ems = 1.0 - Ess;
	vec3 Favg = Fr + ( 1.0 - Fr ) * 0.047619;	vec3 Fms = FssEss * Favg / ( 1.0 - Ems * Favg );
	singleScatter += FssEss;
	multiScatter += Fms * Ems;
}
#if NUM_RECT_AREA_LIGHTS > 0
	void RE_Direct_RectArea_Physical( const in RectAreaLight rectAreaLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
		vec3 normal = geometryNormal;
		vec3 viewDir = geometryViewDir;
		vec3 position = geometryPosition;
		vec3 lightPos = rectAreaLight.position;
		vec3 halfWidth = rectAreaLight.halfWidth;
		vec3 halfHeight = rectAreaLight.halfHeight;
		vec3 lightColor = rectAreaLight.color;
		float roughness = material.roughness;
		vec3 rectCoords[ 4 ];
		rectCoords[ 0 ] = lightPos + halfWidth - halfHeight;		rectCoords[ 1 ] = lightPos - halfWidth - halfHeight;
		rectCoords[ 2 ] = lightPos - halfWidth + halfHeight;
		rectCoords[ 3 ] = lightPos + halfWidth + halfHeight;
		vec2 uv = LTC_Uv( normal, viewDir, roughness );
		vec4 t1 = texture2D( ltc_1, uv );
		vec4 t2 = texture2D( ltc_2, uv );
		mat3 mInv = mat3(
			vec3( t1.x, 0, t1.y ),
			vec3(    0, 1,    0 ),
			vec3( t1.z, 0, t1.w )
		);
		vec3 fresnel = ( material.specularColor * t2.x + ( vec3( 1.0 ) - material.specularColor ) * t2.y );
		reflectedLight.directSpecular += lightColor * fresnel * LTC_Evaluate( normal, viewDir, position, mInv, rectCoords );
		reflectedLight.directDiffuse += lightColor * material.diffuseColor * LTC_Evaluate( normal, viewDir, position, mat3( 1.0 ), rectCoords );
	}
#endif
void RE_Direct_Physical( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	#ifdef USE_CLEARCOAT
		float dotNLcc = saturate( dot( geometryClearcoatNormal, directLight.direction ) );
		vec3 ccIrradiance = dotNLcc * directLight.color;
		clearcoatSpecularDirect += ccIrradiance * BRDF_GGX_Clearcoat( directLight.direction, geometryViewDir, geometryClearcoatNormal, material );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularDirect += irradiance * BRDF_Sheen( directLight.direction, geometryViewDir, geometryNormal, material.sheenColor, material.sheenRoughness );
	#endif
	reflectedLight.directSpecular += irradiance * BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material );
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Physical( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectSpecular_Physical( const in vec3 radiance, const in vec3 irradiance, const in vec3 clearcoatRadiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
	#ifdef USE_CLEARCOAT
		clearcoatSpecularIndirect += clearcoatRadiance * EnvironmentBRDF( geometryClearcoatNormal, geometryViewDir, material.clearcoatF0, material.clearcoatF90, material.clearcoatRoughness );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularIndirect += irradiance * material.sheenColor * IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
	#endif
	vec3 singleScattering = vec3( 0.0 );
	vec3 multiScattering = vec3( 0.0 );
	vec3 cosineWeightedIrradiance = irradiance * RECIPROCAL_PI;
	#ifdef USE_IRIDESCENCE
		computeMultiscatteringIridescence( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.iridescence, material.iridescenceFresnel, material.roughness, singleScattering, multiScattering );
	#else
		computeMultiscattering( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.roughness, singleScattering, multiScattering );
	#endif
	vec3 totalScattering = singleScattering + multiScattering;
	vec3 diffuse = material.diffuseColor * ( 1.0 - max( max( totalScattering.r, totalScattering.g ), totalScattering.b ) );
	reflectedLight.indirectSpecular += radiance * singleScattering;
	reflectedLight.indirectSpecular += multiScattering * cosineWeightedIrradiance;
	reflectedLight.indirectDiffuse += diffuse * cosineWeightedIrradiance;
}
#define RE_Direct				RE_Direct_Physical
#define RE_Direct_RectArea		RE_Direct_RectArea_Physical
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Physical
#define RE_IndirectSpecular		RE_IndirectSpecular_Physical
float computeSpecularOcclusion( const in float dotNV, const in float ambientOcclusion, const in float roughness ) {
	return saturate( pow( dotNV + ambientOcclusion, exp2( - 16.0 * roughness - 1.0 ) ) - 1.0 + ambientOcclusion );
}`,Dh=`
vec3 geometryPosition = - vViewPosition;
vec3 geometryNormal = normal;
vec3 geometryViewDir = ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( vViewPosition );
vec3 geometryClearcoatNormal = vec3( 0.0 );
#ifdef USE_CLEARCOAT
	geometryClearcoatNormal = clearcoatNormal;
#endif
#ifdef USE_IRIDESCENCE
	float dotNVi = saturate( dot( normal, geometryViewDir ) );
	if ( material.iridescenceThickness == 0.0 ) {
		material.iridescence = 0.0;
	} else {
		material.iridescence = saturate( material.iridescence );
	}
	if ( material.iridescence > 0.0 ) {
		material.iridescenceFresnel = evalIridescence( 1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.specularColor );
		material.iridescenceF0 = Schlick_to_F0( material.iridescenceFresnel, 1.0, dotNVi );
	}
#endif
IncidentLight directLight;
#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )
	PointLight pointLight;
	#if defined( USE_SHADOWMAP ) && NUM_POINT_LIGHT_SHADOWS > 0
	PointLightShadow pointLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
		pointLight = pointLights[ i ];
		getPointLightInfo( pointLight, geometryPosition, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_POINT_LIGHT_SHADOWS )
		pointLightShadow = pointLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getPointShadow( pointShadowMap[ i ], pointLightShadow.shadowMapSize, pointLightShadow.shadowIntensity, pointLightShadow.shadowBias, pointLightShadow.shadowRadius, vPointShadowCoord[ i ], pointLightShadow.shadowCameraNear, pointLightShadow.shadowCameraFar ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )
	SpotLight spotLight;
	vec4 spotColor;
	vec3 spotLightCoord;
	bool inSpotLightMap;
	#if defined( USE_SHADOWMAP ) && NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHTS; i ++ ) {
		spotLight = spotLights[ i ];
		getSpotLightInfo( spotLight, geometryPosition, directLight );
		#if ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#define SPOT_LIGHT_MAP_INDEX UNROLLED_LOOP_INDEX
		#elif ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		#define SPOT_LIGHT_MAP_INDEX NUM_SPOT_LIGHT_MAPS
		#else
		#define SPOT_LIGHT_MAP_INDEX ( UNROLLED_LOOP_INDEX - NUM_SPOT_LIGHT_SHADOWS + NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#endif
		#if ( SPOT_LIGHT_MAP_INDEX < NUM_SPOT_LIGHT_MAPS )
			spotLightCoord = vSpotLightCoord[ i ].xyz / vSpotLightCoord[ i ].w;
			inSpotLightMap = all( lessThan( abs( spotLightCoord * 2. - 1. ), vec3( 1.0 ) ) );
			spotColor = texture2D( spotLightMap[ SPOT_LIGHT_MAP_INDEX ], spotLightCoord.xy );
			directLight.color = inSpotLightMap ? directLight.color * spotColor.rgb : directLight.color;
		#endif
		#undef SPOT_LIGHT_MAP_INDEX
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		spotLightShadow = spotLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( spotShadowMap[ i ], spotLightShadow.shadowMapSize, spotLightShadow.shadowIntensity, spotLightShadow.shadowBias, spotLightShadow.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )
	DirectionalLight directionalLight;
	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
		directionalLight = directionalLights[ i ];
		getDirectionalLightInfo( directionalLight, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
		directionalLightShadow = directionalLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_RECT_AREA_LIGHTS > 0 ) && defined( RE_Direct_RectArea )
	RectAreaLight rectAreaLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_RECT_AREA_LIGHTS; i ++ ) {
		rectAreaLight = rectAreaLights[ i ];
		RE_Direct_RectArea( rectAreaLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if defined( RE_IndirectDiffuse )
	vec3 iblIrradiance = vec3( 0.0 );
	vec3 irradiance = getAmbientLightIrradiance( ambientLightColor );
	#if defined( USE_LIGHT_PROBES )
		irradiance += getLightProbeIrradiance( lightProbe, geometryNormal );
	#endif
	#if ( NUM_HEMI_LIGHTS > 0 )
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_HEMI_LIGHTS; i ++ ) {
			irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );
		}
		#pragma unroll_loop_end
	#endif
#endif
#if defined( RE_IndirectSpecular )
	vec3 radiance = vec3( 0.0 );
	vec3 clearcoatRadiance = vec3( 0.0 );
#endif`,Uh=`#if defined( RE_IndirectDiffuse )
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;
		irradiance += lightMapIrradiance;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD ) && defined( ENVMAP_TYPE_CUBE_UV )
		iblIrradiance += getIBLIrradiance( geometryNormal );
	#endif
#endif
#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
	#ifdef USE_ANISOTROPY
		radiance += getIBLAnisotropyRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB, material.anisotropy );
	#else
		radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );
	#endif
	#ifdef USE_CLEARCOAT
		clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness );
	#endif
#endif`,Nh=`#if defined( RE_IndirectDiffuse )
	RE_IndirectDiffuse( irradiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif
#if defined( RE_IndirectSpecular )
	RE_IndirectSpecular( radiance, iblIrradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif`,Fh=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( vFragDepth ) * logDepthBufFC * 0.5;
#endif`,Oh=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	uniform float logDepthBufFC;
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,Bh=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,zh=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	vFragDepth = 1.0 + gl_Position.w;
	vIsPerspective = float( isPerspectiveMatrix( projectionMatrix ) );
#endif`,kh=`#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif`,Vh=`#ifdef USE_MAP
	uniform sampler2D map;
#endif`,Hh=`#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
	#if defined( USE_POINTS_UV )
		vec2 uv = vUv;
	#else
		vec2 uv = ( uvTransform * vec3( gl_PointCoord.x, 1.0 - gl_PointCoord.y, 1 ) ).xy;
	#endif
#endif
#ifdef USE_MAP
	diffuseColor *= texture2D( map, uv );
#endif
#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, uv ).g;
#endif`,Gh=`#if defined( USE_POINTS_UV )
	varying vec2 vUv;
#else
	#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
		uniform mat3 uvTransform;
	#endif
#endif
#ifdef USE_MAP
	uniform sampler2D map;
#endif
#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,Wh=`float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );
	metalnessFactor *= texelMetalness.b;
#endif`,Xh=`#ifdef USE_METALNESSMAP
	uniform sampler2D metalnessMap;
#endif`,qh=`#ifdef USE_INSTANCING_MORPH
	float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	float morphTargetBaseInfluence = texelFetch( morphTexture, ivec2( 0, gl_InstanceID ), 0 ).r;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		morphTargetInfluences[i] =  texelFetch( morphTexture, ivec2( i + 1, gl_InstanceID ), 0 ).r;
	}
#endif`,Yh=`#if defined( USE_MORPHCOLORS )
	vColor *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		#if defined( USE_COLOR_ALPHA )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ) * morphTargetInfluences[ i ];
		#elif defined( USE_COLOR )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ).rgb * morphTargetInfluences[ i ];
		#endif
	}
#endif`,Kh=`#ifdef USE_MORPHNORMALS
	objectNormal *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) objectNormal += getMorph( gl_VertexID, i, 1 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,Zh=`#ifdef USE_MORPHTARGETS
	#ifndef USE_INSTANCING_MORPH
		uniform float morphTargetBaseInfluence;
		uniform float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	#endif
	uniform sampler2DArray morphTargetsTexture;
	uniform ivec2 morphTargetsTextureSize;
	vec4 getMorph( const in int vertexIndex, const in int morphTargetIndex, const in int offset ) {
		int texelIndex = vertexIndex * MORPHTARGETS_TEXTURE_STRIDE + offset;
		int y = texelIndex / morphTargetsTextureSize.x;
		int x = texelIndex - y * morphTargetsTextureSize.x;
		ivec3 morphUV = ivec3( x, y, morphTargetIndex );
		return texelFetch( morphTargetsTexture, morphUV, 0 );
	}
#endif`,Jh=`#ifdef USE_MORPHTARGETS
	transformed *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) transformed += getMorph( gl_VertexID, i, 0 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,jh=`float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
#ifdef FLAT_SHADED
	vec3 fdx = dFdx( vViewPosition );
	vec3 fdy = dFdy( vViewPosition );
	vec3 normal = normalize( cross( fdx, fdy ) );
#else
	vec3 normal = normalize( vNormal );
	#ifdef DOUBLE_SIDED
		normal *= faceDirection;
	#endif
#endif
#if defined( USE_NORMALMAP_TANGENTSPACE ) || defined( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY )
	#ifdef USE_TANGENT
		mat3 tbn = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn = getTangentFrame( - vViewPosition, normal,
		#if defined( USE_NORMALMAP )
			vNormalMapUv
		#elif defined( USE_CLEARCOAT_NORMALMAP )
			vClearcoatNormalMapUv
		#else
			vUv
		#endif
		);
	#endif
	#if defined( DOUBLE_SIDED ) && ! defined( FLAT_SHADED )
		tbn[0] *= faceDirection;
		tbn[1] *= faceDirection;
	#endif
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	#ifdef USE_TANGENT
		mat3 tbn2 = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn2 = getTangentFrame( - vViewPosition, normal, vClearcoatNormalMapUv );
	#endif
	#if defined( DOUBLE_SIDED ) && ! defined( FLAT_SHADED )
		tbn2[0] *= faceDirection;
		tbn2[1] *= faceDirection;
	#endif
#endif
vec3 nonPerturbedNormal = normal;`,$h=`#ifdef USE_NORMALMAP_OBJECTSPACE
	normal = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	#ifdef FLIP_SIDED
		normal = - normal;
	#endif
	#ifdef DOUBLE_SIDED
		normal = normal * faceDirection;
	#endif
	normal = normalize( normalMatrix * normal );
#elif defined( USE_NORMALMAP_TANGENTSPACE )
	vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	mapN.xy *= normalScale;
	normal = normalize( tbn * mapN );
#elif defined( USE_BUMPMAP )
	normal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd(), faceDirection );
#endif`,Qh=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,eu=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,tu=`#ifndef FLAT_SHADED
	vNormal = normalize( transformedNormal );
	#ifdef USE_TANGENT
		vTangent = normalize( transformedTangent );
		vBitangent = normalize( cross( vNormal, vTangent ) * tangent.w );
	#endif
#endif`,nu=`#ifdef USE_NORMALMAP
	uniform sampler2D normalMap;
	uniform vec2 normalScale;
#endif
#ifdef USE_NORMALMAP_OBJECTSPACE
	uniform mat3 normalMatrix;
#endif
#if ! defined ( USE_TANGENT ) && ( defined ( USE_NORMALMAP_TANGENTSPACE ) || defined ( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY ) )
	mat3 getTangentFrame( vec3 eye_pos, vec3 surf_norm, vec2 uv ) {
		vec3 q0 = dFdx( eye_pos.xyz );
		vec3 q1 = dFdy( eye_pos.xyz );
		vec2 st0 = dFdx( uv.st );
		vec2 st1 = dFdy( uv.st );
		vec3 N = surf_norm;
		vec3 q1perp = cross( q1, N );
		vec3 q0perp = cross( N, q0 );
		vec3 T = q1perp * st0.x + q0perp * st1.x;
		vec3 B = q1perp * st0.y + q0perp * st1.y;
		float det = max( dot( T, T ), dot( B, B ) );
		float scale = ( det == 0.0 ) ? 0.0 : inversesqrt( det );
		return mat3( T * scale, B * scale, N );
	}
#endif`,iu=`#ifdef USE_CLEARCOAT
	vec3 clearcoatNormal = nonPerturbedNormal;
#endif`,su=`#ifdef USE_CLEARCOAT_NORMALMAP
	vec3 clearcoatMapN = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv ).xyz * 2.0 - 1.0;
	clearcoatMapN.xy *= clearcoatNormalScale;
	clearcoatNormal = normalize( tbn2 * clearcoatMapN );
#endif`,ru=`#ifdef USE_CLEARCOATMAP
	uniform sampler2D clearcoatMap;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform sampler2D clearcoatNormalMap;
	uniform vec2 clearcoatNormalScale;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform sampler2D clearcoatRoughnessMap;
#endif`,ou=`#ifdef USE_IRIDESCENCEMAP
	uniform sampler2D iridescenceMap;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform sampler2D iridescenceThicknessMap;
#endif`,au=`#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif
#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif
gl_FragColor = vec4( outgoingLight, diffuseColor.a );`,cu=`vec3 packNormalToRGB( const in vec3 normal ) {
	return normalize( normal ) * 0.5 + 0.5;
}
vec3 unpackRGBToNormal( const in vec3 rgb ) {
	return 2.0 * rgb.xyz - 1.0;
}
const float PackUpscale = 256. / 255.;const float UnpackDownscale = 255. / 256.;const float ShiftRight8 = 1. / 256.;
const float Inv255 = 1. / 255.;
const vec4 PackFactors = vec4( 1.0, 256.0, 256.0 * 256.0, 256.0 * 256.0 * 256.0 );
const vec2 UnpackFactors2 = vec2( UnpackDownscale, 1.0 / PackFactors.g );
const vec3 UnpackFactors3 = vec3( UnpackDownscale / PackFactors.rg, 1.0 / PackFactors.b );
const vec4 UnpackFactors4 = vec4( UnpackDownscale / PackFactors.rgb, 1.0 / PackFactors.a );
vec4 packDepthToRGBA( const in float v ) {
	if( v <= 0.0 )
		return vec4( 0., 0., 0., 0. );
	if( v >= 1.0 )
		return vec4( 1., 1., 1., 1. );
	float vuf;
	float af = modf( v * PackFactors.a, vuf );
	float bf = modf( vuf * ShiftRight8, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec4( vuf * Inv255, gf * PackUpscale, bf * PackUpscale, af );
}
vec3 packDepthToRGB( const in float v ) {
	if( v <= 0.0 )
		return vec3( 0., 0., 0. );
	if( v >= 1.0 )
		return vec3( 1., 1., 1. );
	float vuf;
	float bf = modf( v * PackFactors.b, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec3( vuf * Inv255, gf * PackUpscale, bf );
}
vec2 packDepthToRG( const in float v ) {
	if( v <= 0.0 )
		return vec2( 0., 0. );
	if( v >= 1.0 )
		return vec2( 1., 1. );
	float vuf;
	float gf = modf( v * 256., vuf );
	return vec2( vuf * Inv255, gf );
}
float unpackRGBAToDepth( const in vec4 v ) {
	return dot( v, UnpackFactors4 );
}
float unpackRGBToDepth( const in vec3 v ) {
	return dot( v, UnpackFactors3 );
}
float unpackRGToDepth( const in vec2 v ) {
	return v.r * UnpackFactors2.r + v.g * UnpackFactors2.g;
}
vec4 pack2HalfToRGBA( const in vec2 v ) {
	vec4 r = vec4( v.x, fract( v.x * 255.0 ), v.y, fract( v.y * 255.0 ) );
	return vec4( r.x - r.y / 255.0, r.y, r.z - r.w / 255.0, r.w );
}
vec2 unpackRGBATo2Half( const in vec4 v ) {
	return vec2( v.x + ( v.y / 255.0 ), v.z + ( v.w / 255.0 ) );
}
float viewZToOrthographicDepth( const in float viewZ, const in float near, const in float far ) {
	return ( viewZ + near ) / ( near - far );
}
float orthographicDepthToViewZ( const in float depth, const in float near, const in float far ) {
	return depth * ( near - far ) - near;
}
float viewZToPerspectiveDepth( const in float viewZ, const in float near, const in float far ) {
	return ( ( near + viewZ ) * far ) / ( ( far - near ) * viewZ );
}
float perspectiveDepthToViewZ( const in float depth, const in float near, const in float far ) {
	return ( near * far ) / ( ( far - near ) * depth - far );
}`,lu=`#ifdef PREMULTIPLIED_ALPHA
	gl_FragColor.rgb *= gl_FragColor.a;
#endif`,hu=`vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,uu=`#ifdef DITHERING
	gl_FragColor.rgb = dithering( gl_FragColor.rgb );
#endif`,fu=`#ifdef DITHERING
	vec3 dithering( vec3 color ) {
		float grid_position = rand( gl_FragCoord.xy );
		vec3 dither_shift_RGB = vec3( 0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0 );
		dither_shift_RGB = mix( 2.0 * dither_shift_RGB, -2.0 * dither_shift_RGB, grid_position );
		return color + dither_shift_RGB;
	}
#endif`,du=`float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
	roughnessFactor *= texelRoughness.g;
#endif`,pu=`#ifdef USE_ROUGHNESSMAP
	uniform sampler2D roughnessMap;
#endif`,mu=`#if NUM_SPOT_LIGHT_COORDS > 0
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#if NUM_SPOT_LIGHT_MAPS > 0
	uniform sampler2D spotLightMap[ NUM_SPOT_LIGHT_MAPS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform sampler2D directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		uniform sampler2D spotShadowMap[ NUM_SPOT_LIGHT_SHADOWS ];
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform sampler2D pointShadowMap[ NUM_POINT_LIGHT_SHADOWS ];
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
	float texture2DCompare( sampler2D depths, vec2 uv, float compare ) {
		float depth = unpackRGBAToDepth( texture2D( depths, uv ) );
		#ifdef USE_REVERSED_DEPTH_BUFFER
			return step( depth, compare );
		#else
			return step( compare, depth );
		#endif
	}
	vec2 texture2DDistribution( sampler2D shadow, vec2 uv ) {
		return unpackRGBATo2Half( texture2D( shadow, uv ) );
	}
	float VSMShadow( sampler2D shadow, vec2 uv, float compare ) {
		float occlusion = 1.0;
		vec2 distribution = texture2DDistribution( shadow, uv );
		#ifdef USE_REVERSED_DEPTH_BUFFER
			float hard_shadow = step( distribution.x, compare );
		#else
			float hard_shadow = step( compare, distribution.x );
		#endif
		if ( hard_shadow != 1.0 ) {
			float distance = compare - distribution.x;
			float variance = max( 0.00000, distribution.y * distribution.y );
			float softness_probability = variance / (variance + distance * distance );			softness_probability = clamp( ( softness_probability - 0.3 ) / ( 0.95 - 0.3 ), 0.0, 1.0 );			occlusion = clamp( max( hard_shadow, softness_probability ), 0.0, 1.0 );
		}
		return occlusion;
	}
	float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
		float shadow = 1.0;
		shadowCoord.xyz /= shadowCoord.w;
		shadowCoord.z += shadowBias;
		bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
		bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
		if ( frustumTest ) {
		#if defined( SHADOWMAP_TYPE_PCF )
			vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
			float dx0 = - texelSize.x * shadowRadius;
			float dy0 = - texelSize.y * shadowRadius;
			float dx1 = + texelSize.x * shadowRadius;
			float dy1 = + texelSize.y * shadowRadius;
			float dx2 = dx0 / 2.0;
			float dy2 = dy0 / 2.0;
			float dx3 = dx1 / 2.0;
			float dy3 = dy1 / 2.0;
			shadow = (
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy, shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, dy1 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy1 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, dy1 ), shadowCoord.z )
			) * ( 1.0 / 17.0 );
		#elif defined( SHADOWMAP_TYPE_PCF_SOFT )
			vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
			float dx = texelSize.x;
			float dy = texelSize.y;
			vec2 uv = shadowCoord.xy;
			vec2 f = fract( uv * shadowMapSize + 0.5 );
			uv -= f * texelSize;
			shadow = (
				texture2DCompare( shadowMap, uv, shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + vec2( dx, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + vec2( 0.0, dy ), shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + texelSize, shadowCoord.z ) +
				mix( texture2DCompare( shadowMap, uv + vec2( -dx, 0.0 ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, 0.0 ), shadowCoord.z ),
					 f.x ) +
				mix( texture2DCompare( shadowMap, uv + vec2( -dx, dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, dy ), shadowCoord.z ),
					 f.x ) +
				mix( texture2DCompare( shadowMap, uv + vec2( 0.0, -dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 0.0, 2.0 * dy ), shadowCoord.z ),
					 f.y ) +
				mix( texture2DCompare( shadowMap, uv + vec2( dx, -dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( dx, 2.0 * dy ), shadowCoord.z ),
					 f.y ) +
				mix( mix( texture2DCompare( shadowMap, uv + vec2( -dx, -dy ), shadowCoord.z ),
						  texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, -dy ), shadowCoord.z ),
						  f.x ),
					 mix( texture2DCompare( shadowMap, uv + vec2( -dx, 2.0 * dy ), shadowCoord.z ),
						  texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, 2.0 * dy ), shadowCoord.z ),
						  f.x ),
					 f.y )
			) * ( 1.0 / 9.0 );
		#elif defined( SHADOWMAP_TYPE_VSM )
			shadow = VSMShadow( shadowMap, shadowCoord.xy, shadowCoord.z );
		#else
			shadow = texture2DCompare( shadowMap, shadowCoord.xy, shadowCoord.z );
		#endif
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
	vec2 cubeToUV( vec3 v, float texelSizeY ) {
		vec3 absV = abs( v );
		float scaleToCube = 1.0 / max( absV.x, max( absV.y, absV.z ) );
		absV *= scaleToCube;
		v *= scaleToCube * ( 1.0 - 2.0 * texelSizeY );
		vec2 planar = v.xy;
		float almostATexel = 1.5 * texelSizeY;
		float almostOne = 1.0 - almostATexel;
		if ( absV.z >= almostOne ) {
			if ( v.z > 0.0 )
				planar.x = 4.0 - v.x;
		} else if ( absV.x >= almostOne ) {
			float signX = sign( v.x );
			planar.x = v.z * signX + 2.0 * signX;
		} else if ( absV.y >= almostOne ) {
			float signY = sign( v.y );
			planar.x = v.x + 2.0 * signY + 2.0;
			planar.y = v.z * signY - 2.0;
		}
		return vec2( 0.125, 0.25 ) * planar + vec2( 0.375, 0.75 );
	}
	float getPointShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {
		float shadow = 1.0;
		vec3 lightToPosition = shadowCoord.xyz;
		
		float lightToPositionLength = length( lightToPosition );
		if ( lightToPositionLength - shadowCameraFar <= 0.0 && lightToPositionLength - shadowCameraNear >= 0.0 ) {
			float dp = ( lightToPositionLength - shadowCameraNear ) / ( shadowCameraFar - shadowCameraNear );			dp += shadowBias;
			vec3 bd3D = normalize( lightToPosition );
			vec2 texelSize = vec2( 1.0 ) / ( shadowMapSize * vec2( 4.0, 2.0 ) );
			#if defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_PCF_SOFT ) || defined( SHADOWMAP_TYPE_VSM )
				vec2 offset = vec2( - 1, 1 ) * shadowRadius * texelSize.y;
				shadow = (
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xyy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yyy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xyx, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yyx, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xxy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yxy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xxx, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yxx, texelSize.y ), dp )
				) * ( 1.0 / 9.0 );
			#else
				shadow = texture2DCompare( shadowMap, cubeToUV( bd3D, texelSize.y ), dp );
			#endif
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
#endif`,gu=`#if NUM_SPOT_LIGHT_COORDS > 0
	uniform mat4 spotLightMatrix[ NUM_SPOT_LIGHT_COORDS ];
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform mat4 directionalShadowMatrix[ NUM_DIR_LIGHT_SHADOWS ];
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform mat4 pointShadowMatrix[ NUM_POINT_LIGHT_SHADOWS ];
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
#endif`,xu=`#if ( defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 || NUM_POINT_LIGHT_SHADOWS > 0 ) ) || ( NUM_SPOT_LIGHT_COORDS > 0 )
	vec3 shadowWorldNormal = inverseTransformDirection( transformedNormal, viewMatrix );
	vec4 shadowWorldPosition;
#endif
#if defined( USE_SHADOWMAP )
	#if NUM_DIR_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * directionalLightShadows[ i ].shadowNormalBias, 0 );
			vDirectionalShadowCoord[ i ] = directionalShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * pointLightShadows[ i ].shadowNormalBias, 0 );
			vPointShadowCoord[ i ] = pointShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
#endif
#if NUM_SPOT_LIGHT_COORDS > 0
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_COORDS; i ++ ) {
		shadowWorldPosition = worldPosition;
		#if ( defined( USE_SHADOWMAP ) && UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
			shadowWorldPosition.xyz += shadowWorldNormal * spotLightShadows[ i ].shadowNormalBias;
		#endif
		vSpotLightCoord[ i ] = spotLightMatrix[ i ] * shadowWorldPosition;
	}
	#pragma unroll_loop_end
#endif`,_u=`float getShadowMask() {
	float shadow = 1.0;
	#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
		directionalLight = directionalLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( directionalShadowMap[ i ], directionalLight.shadowMapSize, directionalLight.shadowIntensity, directionalLight.shadowBias, directionalLight.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_SHADOWS; i ++ ) {
		spotLight = spotLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( spotShadowMap[ i ], spotLight.shadowMapSize, spotLight.shadowIntensity, spotLight.shadowBias, spotLight.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
	PointLightShadow pointLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
		pointLight = pointLightShadows[ i ];
		shadow *= receiveShadow ? getPointShadow( pointShadowMap[ i ], pointLight.shadowMapSize, pointLight.shadowIntensity, pointLight.shadowBias, pointLight.shadowRadius, vPointShadowCoord[ i ], pointLight.shadowCameraNear, pointLight.shadowCameraFar ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#endif
	return shadow;
}`,yu=`#ifdef USE_SKINNING
	mat4 boneMatX = getBoneMatrix( skinIndex.x );
	mat4 boneMatY = getBoneMatrix( skinIndex.y );
	mat4 boneMatZ = getBoneMatrix( skinIndex.z );
	mat4 boneMatW = getBoneMatrix( skinIndex.w );
#endif`,vu=`#ifdef USE_SKINNING
	uniform mat4 bindMatrix;
	uniform mat4 bindMatrixInverse;
	uniform highp sampler2D boneTexture;
	mat4 getBoneMatrix( const in float i ) {
		int size = textureSize( boneTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( boneTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( boneTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( boneTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( boneTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
#endif`,Mu=`#ifdef USE_SKINNING
	vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );
	vec4 skinned = vec4( 0.0 );
	skinned += boneMatX * skinVertex * skinWeight.x;
	skinned += boneMatY * skinVertex * skinWeight.y;
	skinned += boneMatZ * skinVertex * skinWeight.z;
	skinned += boneMatW * skinVertex * skinWeight.w;
	transformed = ( bindMatrixInverse * skinned ).xyz;
#endif`,Su=`#ifdef USE_SKINNING
	mat4 skinMatrix = mat4( 0.0 );
	skinMatrix += skinWeight.x * boneMatX;
	skinMatrix += skinWeight.y * boneMatY;
	skinMatrix += skinWeight.z * boneMatZ;
	skinMatrix += skinWeight.w * boneMatW;
	skinMatrix = bindMatrixInverse * skinMatrix * bindMatrix;
	objectNormal = vec4( skinMatrix * vec4( objectNormal, 0.0 ) ).xyz;
	#ifdef USE_TANGENT
		objectTangent = vec4( skinMatrix * vec4( objectTangent, 0.0 ) ).xyz;
	#endif
#endif`,Tu=`float specularStrength;
#ifdef USE_SPECULARMAP
	vec4 texelSpecular = texture2D( specularMap, vSpecularMapUv );
	specularStrength = texelSpecular.r;
#else
	specularStrength = 1.0;
#endif`,bu=`#ifdef USE_SPECULARMAP
	uniform sampler2D specularMap;
#endif`,wu=`#if defined( TONE_MAPPING )
	gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
#endif`,Au=`#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
uniform float toneMappingExposure;
vec3 LinearToneMapping( vec3 color ) {
	return saturate( toneMappingExposure * color );
}
vec3 ReinhardToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	return saturate( color / ( vec3( 1.0 ) + color ) );
}
vec3 CineonToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	color = max( vec3( 0.0 ), color - 0.004 );
	return pow( ( color * ( 6.2 * color + 0.5 ) ) / ( color * ( 6.2 * color + 1.7 ) + 0.06 ), vec3( 2.2 ) );
}
vec3 RRTAndODTFit( vec3 v ) {
	vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
	vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
	return a / b;
}
vec3 ACESFilmicToneMapping( vec3 color ) {
	const mat3 ACESInputMat = mat3(
		vec3( 0.59719, 0.07600, 0.02840 ),		vec3( 0.35458, 0.90834, 0.13383 ),
		vec3( 0.04823, 0.01566, 0.83777 )
	);
	const mat3 ACESOutputMat = mat3(
		vec3(  1.60475, -0.10208, -0.00327 ),		vec3( -0.53108,  1.10813, -0.07276 ),
		vec3( -0.07367, -0.00605,  1.07602 )
	);
	color *= toneMappingExposure / 0.6;
	color = ACESInputMat * color;
	color = RRTAndODTFit( color );
	color = ACESOutputMat * color;
	return saturate( color );
}
const mat3 LINEAR_REC2020_TO_LINEAR_SRGB = mat3(
	vec3( 1.6605, - 0.1246, - 0.0182 ),
	vec3( - 0.5876, 1.1329, - 0.1006 ),
	vec3( - 0.0728, - 0.0083, 1.1187 )
);
const mat3 LINEAR_SRGB_TO_LINEAR_REC2020 = mat3(
	vec3( 0.6274, 0.0691, 0.0164 ),
	vec3( 0.3293, 0.9195, 0.0880 ),
	vec3( 0.0433, 0.0113, 0.8956 )
);
vec3 agxDefaultContrastApprox( vec3 x ) {
	vec3 x2 = x * x;
	vec3 x4 = x2 * x2;
	return + 15.5 * x4 * x2
		- 40.14 * x4 * x
		+ 31.96 * x4
		- 6.868 * x2 * x
		+ 0.4298 * x2
		+ 0.1191 * x
		- 0.00232;
}
vec3 AgXToneMapping( vec3 color ) {
	const mat3 AgXInsetMatrix = mat3(
		vec3( 0.856627153315983, 0.137318972929847, 0.11189821299995 ),
		vec3( 0.0951212405381588, 0.761241990602591, 0.0767994186031903 ),
		vec3( 0.0482516061458583, 0.101439036467562, 0.811302368396859 )
	);
	const mat3 AgXOutsetMatrix = mat3(
		vec3( 1.1271005818144368, - 0.1413297634984383, - 0.14132976349843826 ),
		vec3( - 0.11060664309660323, 1.157823702216272, - 0.11060664309660294 ),
		vec3( - 0.016493938717834573, - 0.016493938717834257, 1.2519364065950405 )
	);
	const float AgxMinEv = - 12.47393;	const float AgxMaxEv = 4.026069;
	color *= toneMappingExposure;
	color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;
	color = AgXInsetMatrix * color;
	color = max( color, 1e-10 );	color = log2( color );
	color = ( color - AgxMinEv ) / ( AgxMaxEv - AgxMinEv );
	color = clamp( color, 0.0, 1.0 );
	color = agxDefaultContrastApprox( color );
	color = AgXOutsetMatrix * color;
	color = pow( max( vec3( 0.0 ), color ), vec3( 2.2 ) );
	color = LINEAR_REC2020_TO_LINEAR_SRGB * color;
	color = clamp( color, 0.0, 1.0 );
	return color;
}
vec3 NeutralToneMapping( vec3 color ) {
	const float StartCompression = 0.8 - 0.04;
	const float Desaturation = 0.15;
	color *= toneMappingExposure;
	float x = min( color.r, min( color.g, color.b ) );
	float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
	color -= offset;
	float peak = max( color.r, max( color.g, color.b ) );
	if ( peak < StartCompression ) return color;
	float d = 1. - StartCompression;
	float newPeak = 1. - d * d / ( peak + d - StartCompression );
	color *= newPeak / peak;
	float g = 1. - 1. / ( Desaturation * ( peak - newPeak ) + 1. );
	return mix( color, vec3( newPeak ), g );
}
vec3 CustomToneMapping( vec3 color ) { return color; }`,Eu=`#ifdef USE_TRANSMISSION
	material.transmission = transmission;
	material.transmissionAlpha = 1.0;
	material.thickness = thickness;
	material.attenuationDistance = attenuationDistance;
	material.attenuationColor = attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		material.transmission *= texture2D( transmissionMap, vTransmissionMapUv ).r;
	#endif
	#ifdef USE_THICKNESSMAP
		material.thickness *= texture2D( thicknessMap, vThicknessMapUv ).g;
	#endif
	vec3 pos = vWorldPosition;
	vec3 v = normalize( cameraPosition - pos );
	vec3 n = inverseTransformDirection( normal, viewMatrix );
	vec4 transmitted = getIBLVolumeRefraction(
		n, v, material.roughness, material.diffuseColor, material.specularColor, material.specularF90,
		pos, modelMatrix, viewMatrix, projectionMatrix, material.dispersion, material.ior, material.thickness,
		material.attenuationColor, material.attenuationDistance );
	material.transmissionAlpha = mix( material.transmissionAlpha, transmitted.a, material.transmission );
	totalDiffuse = mix( totalDiffuse, transmitted.rgb, material.transmission );
#endif`,Ru=`#ifdef USE_TRANSMISSION
	uniform float transmission;
	uniform float thickness;
	uniform float attenuationDistance;
	uniform vec3 attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		uniform sampler2D transmissionMap;
	#endif
	#ifdef USE_THICKNESSMAP
		uniform sampler2D thicknessMap;
	#endif
	uniform vec2 transmissionSamplerSize;
	uniform sampler2D transmissionSamplerMap;
	uniform mat4 modelMatrix;
	uniform mat4 projectionMatrix;
	varying vec3 vWorldPosition;
	float w0( float a ) {
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - a + 3.0 ) - 3.0 ) + 1.0 );
	}
	float w1( float a ) {
		return ( 1.0 / 6.0 ) * ( a *  a * ( 3.0 * a - 6.0 ) + 4.0 );
	}
	float w2( float a ){
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - 3.0 * a + 3.0 ) + 3.0 ) + 1.0 );
	}
	float w3( float a ) {
		return ( 1.0 / 6.0 ) * ( a * a * a );
	}
	float g0( float a ) {
		return w0( a ) + w1( a );
	}
	float g1( float a ) {
		return w2( a ) + w3( a );
	}
	float h0( float a ) {
		return - 1.0 + w1( a ) / ( w0( a ) + w1( a ) );
	}
	float h1( float a ) {
		return 1.0 + w3( a ) / ( w2( a ) + w3( a ) );
	}
	vec4 bicubic( sampler2D tex, vec2 uv, vec4 texelSize, float lod ) {
		uv = uv * texelSize.zw + 0.5;
		vec2 iuv = floor( uv );
		vec2 fuv = fract( uv );
		float g0x = g0( fuv.x );
		float g1x = g1( fuv.x );
		float h0x = h0( fuv.x );
		float h1x = h1( fuv.x );
		float h0y = h0( fuv.y );
		float h1y = h1( fuv.y );
		vec2 p0 = ( vec2( iuv.x + h0x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p1 = ( vec2( iuv.x + h1x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p2 = ( vec2( iuv.x + h0x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		vec2 p3 = ( vec2( iuv.x + h1x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		return g0( fuv.y ) * ( g0x * textureLod( tex, p0, lod ) + g1x * textureLod( tex, p1, lod ) ) +
			g1( fuv.y ) * ( g0x * textureLod( tex, p2, lod ) + g1x * textureLod( tex, p3, lod ) );
	}
	vec4 textureBicubic( sampler2D sampler, vec2 uv, float lod ) {
		vec2 fLodSize = vec2( textureSize( sampler, int( lod ) ) );
		vec2 cLodSize = vec2( textureSize( sampler, int( lod + 1.0 ) ) );
		vec2 fLodSizeInv = 1.0 / fLodSize;
		vec2 cLodSizeInv = 1.0 / cLodSize;
		vec4 fSample = bicubic( sampler, uv, vec4( fLodSizeInv, fLodSize ), floor( lod ) );
		vec4 cSample = bicubic( sampler, uv, vec4( cLodSizeInv, cLodSize ), ceil( lod ) );
		return mix( fSample, cSample, fract( lod ) );
	}
	vec3 getVolumeTransmissionRay( const in vec3 n, const in vec3 v, const in float thickness, const in float ior, const in mat4 modelMatrix ) {
		vec3 refractionVector = refract( - v, normalize( n ), 1.0 / ior );
		vec3 modelScale;
		modelScale.x = length( vec3( modelMatrix[ 0 ].xyz ) );
		modelScale.y = length( vec3( modelMatrix[ 1 ].xyz ) );
		modelScale.z = length( vec3( modelMatrix[ 2 ].xyz ) );
		return normalize( refractionVector ) * thickness * modelScale;
	}
	float applyIorToRoughness( const in float roughness, const in float ior ) {
		return roughness * clamp( ior * 2.0 - 2.0, 0.0, 1.0 );
	}
	vec4 getTransmissionSample( const in vec2 fragCoord, const in float roughness, const in float ior ) {
		float lod = log2( transmissionSamplerSize.x ) * applyIorToRoughness( roughness, ior );
		return textureBicubic( transmissionSamplerMap, fragCoord.xy, lod );
	}
	vec3 volumeAttenuation( const in float transmissionDistance, const in vec3 attenuationColor, const in float attenuationDistance ) {
		if ( isinf( attenuationDistance ) ) {
			return vec3( 1.0 );
		} else {
			vec3 attenuationCoefficient = -log( attenuationColor ) / attenuationDistance;
			vec3 transmittance = exp( - attenuationCoefficient * transmissionDistance );			return transmittance;
		}
	}
	vec4 getIBLVolumeRefraction( const in vec3 n, const in vec3 v, const in float roughness, const in vec3 diffuseColor,
		const in vec3 specularColor, const in float specularF90, const in vec3 position, const in mat4 modelMatrix,
		const in mat4 viewMatrix, const in mat4 projMatrix, const in float dispersion, const in float ior, const in float thickness,
		const in vec3 attenuationColor, const in float attenuationDistance ) {
		vec4 transmittedLight;
		vec3 transmittance;
		#ifdef USE_DISPERSION
			float halfSpread = ( ior - 1.0 ) * 0.025 * dispersion;
			vec3 iors = vec3( ior - halfSpread, ior, ior + halfSpread );
			for ( int i = 0; i < 3; i ++ ) {
				vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, iors[ i ], modelMatrix );
				vec3 refractedRayExit = position + transmissionRay;
				vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
				vec2 refractionCoords = ndcPos.xy / ndcPos.w;
				refractionCoords += 1.0;
				refractionCoords /= 2.0;
				vec4 transmissionSample = getTransmissionSample( refractionCoords, roughness, iors[ i ] );
				transmittedLight[ i ] = transmissionSample[ i ];
				transmittedLight.a += transmissionSample.a;
				transmittance[ i ] = diffuseColor[ i ] * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance )[ i ];
			}
			transmittedLight.a /= 3.0;
		#else
			vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, ior, modelMatrix );
			vec3 refractedRayExit = position + transmissionRay;
			vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
			vec2 refractionCoords = ndcPos.xy / ndcPos.w;
			refractionCoords += 1.0;
			refractionCoords /= 2.0;
			transmittedLight = getTransmissionSample( refractionCoords, roughness, ior );
			transmittance = diffuseColor * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance );
		#endif
		vec3 attenuatedColor = transmittance * transmittedLight.rgb;
		vec3 F = EnvironmentBRDF( n, v, specularColor, specularF90, roughness );
		float transmittanceFactor = ( transmittance.r + transmittance.g + transmittance.b ) / 3.0;
		return vec4( ( 1.0 - F ) * attenuatedColor, 1.0 - ( 1.0 - transmittedLight.a ) * transmittanceFactor );
	}
#endif`,Cu=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_SPECULARMAP
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,Iu=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	uniform mat3 mapTransform;
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	uniform mat3 alphaMapTransform;
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	uniform mat3 lightMapTransform;
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	uniform mat3 aoMapTransform;
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	uniform mat3 bumpMapTransform;
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	uniform mat3 normalMapTransform;
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_DISPLACEMENTMAP
	uniform mat3 displacementMapTransform;
	varying vec2 vDisplacementMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	uniform mat3 emissiveMapTransform;
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	uniform mat3 metalnessMapTransform;
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	uniform mat3 roughnessMapTransform;
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	uniform mat3 anisotropyMapTransform;
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	uniform mat3 clearcoatMapTransform;
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform mat3 clearcoatNormalMapTransform;
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform mat3 clearcoatRoughnessMapTransform;
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	uniform mat3 sheenColorMapTransform;
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	uniform mat3 sheenRoughnessMapTransform;
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	uniform mat3 iridescenceMapTransform;
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform mat3 iridescenceThicknessMapTransform;
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SPECULARMAP
	uniform mat3 specularMapTransform;
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	uniform mat3 specularColorMapTransform;
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	uniform mat3 specularIntensityMapTransform;
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,Pu=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	vUv = vec3( uv, 1 ).xy;
#endif
#ifdef USE_MAP
	vMapUv = ( mapTransform * vec3( MAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ALPHAMAP
	vAlphaMapUv = ( alphaMapTransform * vec3( ALPHAMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_LIGHTMAP
	vLightMapUv = ( lightMapTransform * vec3( LIGHTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_AOMAP
	vAoMapUv = ( aoMapTransform * vec3( AOMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_BUMPMAP
	vBumpMapUv = ( bumpMapTransform * vec3( BUMPMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_NORMALMAP
	vNormalMapUv = ( normalMapTransform * vec3( NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_DISPLACEMENTMAP
	vDisplacementMapUv = ( displacementMapTransform * vec3( DISPLACEMENTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_EMISSIVEMAP
	vEmissiveMapUv = ( emissiveMapTransform * vec3( EMISSIVEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_METALNESSMAP
	vMetalnessMapUv = ( metalnessMapTransform * vec3( METALNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ROUGHNESSMAP
	vRoughnessMapUv = ( roughnessMapTransform * vec3( ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ANISOTROPYMAP
	vAnisotropyMapUv = ( anisotropyMapTransform * vec3( ANISOTROPYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOATMAP
	vClearcoatMapUv = ( clearcoatMapTransform * vec3( CLEARCOATMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	vClearcoatNormalMapUv = ( clearcoatNormalMapTransform * vec3( CLEARCOAT_NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	vClearcoatRoughnessMapUv = ( clearcoatRoughnessMapTransform * vec3( CLEARCOAT_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCEMAP
	vIridescenceMapUv = ( iridescenceMapTransform * vec3( IRIDESCENCEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	vIridescenceThicknessMapUv = ( iridescenceThicknessMapTransform * vec3( IRIDESCENCE_THICKNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_COLORMAP
	vSheenColorMapUv = ( sheenColorMapTransform * vec3( SHEEN_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	vSheenRoughnessMapUv = ( sheenRoughnessMapTransform * vec3( SHEEN_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULARMAP
	vSpecularMapUv = ( specularMapTransform * vec3( SPECULARMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_COLORMAP
	vSpecularColorMapUv = ( specularColorMapTransform * vec3( SPECULAR_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	vSpecularIntensityMapUv = ( specularIntensityMapTransform * vec3( SPECULAR_INTENSITYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_TRANSMISSIONMAP
	vTransmissionMapUv = ( transmissionMapTransform * vec3( TRANSMISSIONMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_THICKNESSMAP
	vThicknessMapUv = ( thicknessMapTransform * vec3( THICKNESSMAP_UV, 1 ) ).xy;
#endif`,Lu=`#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
	vec4 worldPosition = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		worldPosition = batchingMatrix * worldPosition;
	#endif
	#ifdef USE_INSTANCING
		worldPosition = instanceMatrix * worldPosition;
	#endif
	worldPosition = modelMatrix * worldPosition;
#endif`,Du=`varying vec2 vUv;
uniform mat3 uvTransform;
void main() {
	vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	gl_Position = vec4( position.xy, 1.0, 1.0 );
}`,Uu=`uniform sampler2D t2D;
uniform float backgroundIntensity;
varying vec2 vUv;
void main() {
	vec4 texColor = texture2D( t2D, vUv );
	#ifdef DECODE_VIDEO_TEXTURE
		texColor = vec4( mix( pow( texColor.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), texColor.rgb * 0.0773993808, vec3( lessThanEqual( texColor.rgb, vec3( 0.04045 ) ) ) ), texColor.w );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,Nu=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,Fu=`#ifdef ENVMAP_TYPE_CUBE
	uniform samplerCube envMap;
#elif defined( ENVMAP_TYPE_CUBE_UV )
	uniform sampler2D envMap;
#endif
uniform float flipEnvMap;
uniform float backgroundBlurriness;
uniform float backgroundIntensity;
uniform mat3 backgroundRotation;
varying vec3 vWorldDirection;
#include <cube_uv_reflection_fragment>
void main() {
	#ifdef ENVMAP_TYPE_CUBE
		vec4 texColor = textureCube( envMap, backgroundRotation * vec3( flipEnvMap * vWorldDirection.x, vWorldDirection.yz ) );
	#elif defined( ENVMAP_TYPE_CUBE_UV )
		vec4 texColor = textureCubeUV( envMap, backgroundRotation * vWorldDirection, backgroundBlurriness );
	#else
		vec4 texColor = vec4( 0.0, 0.0, 0.0, 1.0 );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,Ou=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,Bu=`uniform samplerCube tCube;
uniform float tFlip;
uniform float opacity;
varying vec3 vWorldDirection;
void main() {
	vec4 texColor = textureCube( tCube, vec3( tFlip * vWorldDirection.x, vWorldDirection.yz ) );
	gl_FragColor = texColor;
	gl_FragColor.a *= opacity;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,zu=`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
varying vec2 vHighPrecisionZW;
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vHighPrecisionZW = gl_Position.zw;
}`,ku=`#if DEPTH_PACKING == 3200
	uniform float opacity;
#endif
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
varying vec2 vHighPrecisionZW;
void main() {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#if DEPTH_PACKING == 3200
		diffuseColor.a = opacity;
	#endif
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <logdepthbuf_fragment>
	#ifdef USE_REVERSED_DEPTH_BUFFER
		float fragCoordZ = vHighPrecisionZW[ 0 ] / vHighPrecisionZW[ 1 ];
	#else
		float fragCoordZ = 0.5 * vHighPrecisionZW[ 0 ] / vHighPrecisionZW[ 1 ] + 0.5;
	#endif
	#if DEPTH_PACKING == 3200
		gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );
	#elif DEPTH_PACKING == 3201
		gl_FragColor = packDepthToRGBA( fragCoordZ );
	#elif DEPTH_PACKING == 3202
		gl_FragColor = vec4( packDepthToRGB( fragCoordZ ), 1.0 );
	#elif DEPTH_PACKING == 3203
		gl_FragColor = vec4( packDepthToRG( fragCoordZ ), 0.0, 1.0 );
	#endif
}`,Vu=`#define DISTANCE
varying vec3 vWorldPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <worldpos_vertex>
	#include <clipping_planes_vertex>
	vWorldPosition = worldPosition.xyz;
}`,Hu=`#define DISTANCE
uniform vec3 referencePosition;
uniform float nearDistance;
uniform float farDistance;
varying vec3 vWorldPosition;
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <clipping_planes_pars_fragment>
void main () {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	float dist = length( vWorldPosition - referencePosition );
	dist = ( dist - nearDistance ) / ( farDistance - nearDistance );
	dist = saturate( dist );
	gl_FragColor = packDepthToRGBA( dist );
}`,Gu=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
}`,Wu=`uniform sampler2D tEquirect;
varying vec3 vWorldDirection;
#include <common>
void main() {
	vec3 direction = normalize( vWorldDirection );
	vec2 sampleUV = equirectUv( direction );
	gl_FragColor = texture2D( tEquirect, sampleUV );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,Xu=`uniform float scale;
attribute float lineDistance;
varying float vLineDistance;
#include <common>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	vLineDistance = scale * lineDistance;
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,qu=`uniform vec3 diffuse;
uniform float opacity;
uniform float dashSize;
uniform float totalSize;
varying float vLineDistance;
#include <common>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	if ( mod( vLineDistance, totalSize ) > dashSize ) {
		discard;
	}
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,Yu=`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinbase_vertex>
		#include <skinnormal_vertex>
		#include <defaultnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <fog_vertex>
}`,Ku=`uniform vec3 diffuse;
uniform float opacity;
#ifndef FLAT_SHADED
	varying vec3 vNormal;
#endif
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		reflectedLight.indirectDiffuse += lightMapTexel.rgb * lightMapIntensity * RECIPROCAL_PI;
	#else
		reflectedLight.indirectDiffuse += vec3( 1.0 );
	#endif
	#include <aomap_fragment>
	reflectedLight.indirectDiffuse *= diffuseColor.rgb;
	vec3 outgoingLight = reflectedLight.indirectDiffuse;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,Zu=`#define LAMBERT
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,Ju=`#define LAMBERT
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_lambert_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_lambert_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,ju=`#define MATCAP
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <displacementmap_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
	vViewPosition = - mvPosition.xyz;
}`,$u=`#define MATCAP
uniform vec3 diffuse;
uniform float opacity;
uniform sampler2D matcap;
varying vec3 vViewPosition;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	vec3 viewDir = normalize( vViewPosition );
	vec3 x = normalize( vec3( viewDir.z, 0.0, - viewDir.x ) );
	vec3 y = cross( viewDir, x );
	vec2 uv = vec2( dot( x, normal ), dot( y, normal ) ) * 0.495 + 0.5;
	#ifdef USE_MATCAP
		vec4 matcapColor = texture2D( matcap, uv );
	#else
		vec4 matcapColor = vec4( vec3( mix( 0.2, 0.8, uv.y ) ), 1.0 );
	#endif
	vec3 outgoingLight = diffuseColor.rgb * matcapColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,Qu=`#define NORMAL
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	vViewPosition = - mvPosition.xyz;
#endif
}`,ef=`#define NORMAL
uniform float opacity;
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <packing>
#include <uv_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( 0.0, 0.0, 0.0, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	gl_FragColor = vec4( packNormalToRGB( normal ), diffuseColor.a );
	#ifdef OPAQUE
		gl_FragColor.a = 1.0;
	#endif
}`,tf=`#define PHONG
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,nf=`#define PHONG
uniform vec3 diffuse;
uniform vec3 emissive;
uniform vec3 specular;
uniform float shininess;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_phong_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_phong_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,sf=`#define STANDARD
varying vec3 vViewPosition;
#ifdef USE_TRANSMISSION
	varying vec3 vWorldPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
#ifdef USE_TRANSMISSION
	vWorldPosition = worldPosition.xyz;
#endif
}`,rf=`#define STANDARD
#ifdef PHYSICAL
	#define IOR
	#define USE_SPECULAR
#endif
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float roughness;
uniform float metalness;
uniform float opacity;
#ifdef IOR
	uniform float ior;
#endif
#ifdef USE_SPECULAR
	uniform float specularIntensity;
	uniform vec3 specularColor;
	#ifdef USE_SPECULAR_COLORMAP
		uniform sampler2D specularColorMap;
	#endif
	#ifdef USE_SPECULAR_INTENSITYMAP
		uniform sampler2D specularIntensityMap;
	#endif
#endif
#ifdef USE_CLEARCOAT
	uniform float clearcoat;
	uniform float clearcoatRoughness;
#endif
#ifdef USE_DISPERSION
	uniform float dispersion;
#endif
#ifdef USE_IRIDESCENCE
	uniform float iridescence;
	uniform float iridescenceIOR;
	uniform float iridescenceThicknessMinimum;
	uniform float iridescenceThicknessMaximum;
#endif
#ifdef USE_SHEEN
	uniform vec3 sheenColor;
	uniform float sheenRoughness;
	#ifdef USE_SHEEN_COLORMAP
		uniform sampler2D sheenColorMap;
	#endif
	#ifdef USE_SHEEN_ROUGHNESSMAP
		uniform sampler2D sheenRoughnessMap;
	#endif
#endif
#ifdef USE_ANISOTROPY
	uniform vec2 anisotropyVector;
	#ifdef USE_ANISOTROPYMAP
		uniform sampler2D anisotropyMap;
	#endif
#endif
varying vec3 vViewPosition;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <iridescence_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_physical_pars_fragment>
#include <transmission_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <clearcoat_pars_fragment>
#include <iridescence_pars_fragment>
#include <roughnessmap_pars_fragment>
#include <metalnessmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <roughnessmap_fragment>
	#include <metalnessmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <clearcoat_normal_fragment_begin>
	#include <clearcoat_normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_physical_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
	vec3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
	#include <transmission_fragment>
	vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;
	#ifdef USE_SHEEN
		float sheenEnergyComp = 1.0 - 0.157 * max3( material.sheenColor );
		outgoingLight = outgoingLight * sheenEnergyComp + sheenSpecularDirect + sheenSpecularIndirect;
	#endif
	#ifdef USE_CLEARCOAT
		float dotNVcc = saturate( dot( geometryClearcoatNormal, geometryViewDir ) );
		vec3 Fcc = F_Schlick( material.clearcoatF0, material.clearcoatF90, dotNVcc );
		outgoingLight = outgoingLight * ( 1.0 - material.clearcoat * Fcc ) + ( clearcoatSpecularDirect + clearcoatSpecularIndirect ) * material.clearcoat;
	#endif
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,of=`#define TOON
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,af=`#define TOON
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <gradientmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_toon_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_toon_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,cf=`uniform float size;
uniform float scale;
#include <common>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
#ifdef USE_POINTS_UV
	varying vec2 vUv;
	uniform mat3 uvTransform;
#endif
void main() {
	#ifdef USE_POINTS_UV
		vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	#endif
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	gl_PointSize = size;
	#ifdef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) gl_PointSize *= ( scale / - mvPosition.z );
	#endif
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <fog_vertex>
}`,lf=`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <color_pars_fragment>
#include <map_particle_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_particle_fragment>
	#include <color_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,hf=`#include <common>
#include <batching_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <shadowmap_pars_vertex>
void main() {
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,uf=`uniform vec3 color;
uniform float opacity;
#include <common>
#include <packing>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <logdepthbuf_pars_fragment>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
void main() {
	#include <logdepthbuf_fragment>
	gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`,ff=`uniform float rotation;
uniform vec2 center;
#include <common>
#include <uv_pars_vertex>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	vec4 mvPosition = modelViewMatrix[ 3 ];
	vec2 scale = vec2( length( modelMatrix[ 0 ].xyz ), length( modelMatrix[ 1 ].xyz ) );
	#ifndef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) scale *= - mvPosition.z;
	#endif
	vec2 alignedPosition = ( position.xy - ( center - vec2( 0.5 ) ) ) * scale;
	vec2 rotatedPosition;
	rotatedPosition.x = cos( rotation ) * alignedPosition.x - sin( rotation ) * alignedPosition.y;
	rotatedPosition.y = sin( rotation ) * alignedPosition.x + cos( rotation ) * alignedPosition.y;
	mvPosition.xy += rotatedPosition;
	gl_Position = projectionMatrix * mvPosition;
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,df=`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`,J={alphahash_fragment:Ul,alphahash_pars_fragment:Nl,alphamap_fragment:Fl,alphamap_pars_fragment:Ol,alphatest_fragment:Bl,alphatest_pars_fragment:zl,aomap_fragment:kl,aomap_pars_fragment:Vl,batching_pars_vertex:Hl,batching_vertex:Gl,begin_vertex:Wl,beginnormal_vertex:Xl,bsdfs:ql,iridescence_fragment:Yl,bumpmap_pars_fragment:Kl,clipping_planes_fragment:Zl,clipping_planes_pars_fragment:Jl,clipping_planes_pars_vertex:jl,clipping_planes_vertex:$l,color_fragment:Ql,color_pars_fragment:eh,color_pars_vertex:th,color_vertex:nh,common:ih,cube_uv_reflection_fragment:sh,defaultnormal_vertex:rh,displacementmap_pars_vertex:oh,displacementmap_vertex:ah,emissivemap_fragment:ch,emissivemap_pars_fragment:lh,colorspace_fragment:hh,colorspace_pars_fragment:uh,envmap_fragment:fh,envmap_common_pars_fragment:dh,envmap_pars_fragment:ph,envmap_pars_vertex:mh,envmap_physical_pars_fragment:Ah,envmap_vertex:gh,fog_vertex:xh,fog_pars_vertex:_h,fog_fragment:yh,fog_pars_fragment:vh,gradientmap_pars_fragment:Mh,lightmap_pars_fragment:Sh,lights_lambert_fragment:Th,lights_lambert_pars_fragment:bh,lights_pars_begin:wh,lights_toon_fragment:Eh,lights_toon_pars_fragment:Rh,lights_phong_fragment:Ch,lights_phong_pars_fragment:Ih,lights_physical_fragment:Ph,lights_physical_pars_fragment:Lh,lights_fragment_begin:Dh,lights_fragment_maps:Uh,lights_fragment_end:Nh,logdepthbuf_fragment:Fh,logdepthbuf_pars_fragment:Oh,logdepthbuf_pars_vertex:Bh,logdepthbuf_vertex:zh,map_fragment:kh,map_pars_fragment:Vh,map_particle_fragment:Hh,map_particle_pars_fragment:Gh,metalnessmap_fragment:Wh,metalnessmap_pars_fragment:Xh,morphinstance_vertex:qh,morphcolor_vertex:Yh,morphnormal_vertex:Kh,morphtarget_pars_vertex:Zh,morphtarget_vertex:Jh,normal_fragment_begin:jh,normal_fragment_maps:$h,normal_pars_fragment:Qh,normal_pars_vertex:eu,normal_vertex:tu,normalmap_pars_fragment:nu,clearcoat_normal_fragment_begin:iu,clearcoat_normal_fragment_maps:su,clearcoat_pars_fragment:ru,iridescence_pars_fragment:ou,opaque_fragment:au,packing:cu,premultiplied_alpha_fragment:lu,project_vertex:hu,dithering_fragment:uu,dithering_pars_fragment:fu,roughnessmap_fragment:du,roughnessmap_pars_fragment:pu,shadowmap_pars_fragment:mu,shadowmap_pars_vertex:gu,shadowmap_vertex:xu,shadowmask_pars_fragment:_u,skinbase_vertex:yu,skinning_pars_vertex:vu,skinning_vertex:Mu,skinnormal_vertex:Su,specularmap_fragment:Tu,specularmap_pars_fragment:bu,tonemapping_fragment:wu,tonemapping_pars_fragment:Au,transmission_fragment:Eu,transmission_pars_fragment:Ru,uv_pars_fragment:Cu,uv_pars_vertex:Iu,uv_vertex:Pu,worldpos_vertex:Lu,background_vert:Du,background_frag:Uu,backgroundCube_vert:Nu,backgroundCube_frag:Fu,cube_vert:Ou,cube_frag:Bu,depth_vert:zu,depth_frag:ku,distanceRGBA_vert:Vu,distanceRGBA_frag:Hu,equirect_vert:Gu,equirect_frag:Wu,linedashed_vert:Xu,linedashed_frag:qu,meshbasic_vert:Yu,meshbasic_frag:Ku,meshlambert_vert:Zu,meshlambert_frag:Ju,meshmatcap_vert:ju,meshmatcap_frag:$u,meshnormal_vert:Qu,meshnormal_frag:ef,meshphong_vert:tf,meshphong_frag:nf,meshphysical_vert:sf,meshphysical_frag:rf,meshtoon_vert:of,meshtoon_frag:af,points_vert:cf,points_frag:lf,shadow_vert:hf,shadow_frag:uf,sprite_vert:ff,sprite_frag:df},I={common:{diffuse:{value:new L(16777215)},opacity:{value:1},map:{value:null},mapTransform:{value:new k},alphaMap:{value:null},alphaMapTransform:{value:new k},alphaTest:{value:0}},specularmap:{specularMap:{value:null},specularMapTransform:{value:new k}},envmap:{envMap:{value:null},envMapRotation:{value:new k},flipEnvMap:{value:-1},reflectivity:{value:1},ior:{value:1.5},refractionRatio:{value:.98}},aomap:{aoMap:{value:null},aoMapIntensity:{value:1},aoMapTransform:{value:new k}},lightmap:{lightMap:{value:null},lightMapIntensity:{value:1},lightMapTransform:{value:new k}},bumpmap:{bumpMap:{value:null},bumpMapTransform:{value:new k},bumpScale:{value:1}},normalmap:{normalMap:{value:null},normalMapTransform:{value:new k},normalScale:{value:new Z(1,1)}},displacementmap:{displacementMap:{value:null},displacementMapTransform:{value:new k},displacementScale:{value:1},displacementBias:{value:0}},emissivemap:{emissiveMap:{value:null},emissiveMapTransform:{value:new k}},metalnessmap:{metalnessMap:{value:null},metalnessMapTransform:{value:new k}},roughnessmap:{roughnessMap:{value:null},roughnessMapTransform:{value:new k}},gradientmap:{gradientMap:{value:null}},fog:{fogDensity:{value:25e-5},fogNear:{value:1},fogFar:{value:2e3},fogColor:{value:new L(16777215)}},lights:{ambientLightColor:{value:[]},lightProbe:{value:[]},directionalLights:{value:[],properties:{direction:{},color:{}}},directionalLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},directionalShadowMap:{value:[]},directionalShadowMatrix:{value:[]},spotLights:{value:[],properties:{color:{},position:{},direction:{},distance:{},coneCos:{},penumbraCos:{},decay:{}}},spotLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},spotLightMap:{value:[]},spotShadowMap:{value:[]},spotLightMatrix:{value:[]},pointLights:{value:[],properties:{color:{},position:{},decay:{},distance:{}}},pointLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{},shadowCameraNear:{},shadowCameraFar:{}}},pointShadowMap:{value:[]},pointShadowMatrix:{value:[]},hemisphereLights:{value:[],properties:{direction:{},skyColor:{},groundColor:{}}},rectAreaLights:{value:[],properties:{color:{},position:{},width:{},height:{}}},ltc_1:{value:null},ltc_2:{value:null}},points:{diffuse:{value:new L(16777215)},opacity:{value:1},size:{value:1},scale:{value:1},map:{value:null},alphaMap:{value:null},alphaMapTransform:{value:new k},alphaTest:{value:0},uvTransform:{value:new k}},sprite:{diffuse:{value:new L(16777215)},opacity:{value:1},center:{value:new Z(.5,.5)},rotation:{value:0},map:{value:null},mapTransform:{value:new k},alphaMap:{value:null},alphaMapTransform:{value:new k},alphaTest:{value:0}}},qa={basic:{uniforms:Ae([I.common,I.specularmap,I.envmap,I.aomap,I.lightmap,I.fog]),vertexShader:J.meshbasic_vert,fragmentShader:J.meshbasic_frag},lambert:{uniforms:Ae([I.common,I.specularmap,I.envmap,I.aomap,I.lightmap,I.emissivemap,I.bumpmap,I.normalmap,I.displacementmap,I.fog,I.lights,{emissive:{value:new L(0)}}]),vertexShader:J.meshlambert_vert,fragmentShader:J.meshlambert_frag},phong:{uniforms:Ae([I.common,I.specularmap,I.envmap,I.aomap,I.lightmap,I.emissivemap,I.bumpmap,I.normalmap,I.displacementmap,I.fog,I.lights,{emissive:{value:new L(0)},specular:{value:new L(1118481)},shininess:{value:30}}]),vertexShader:J.meshphong_vert,fragmentShader:J.meshphong_frag},standard:{uniforms:Ae([I.common,I.envmap,I.aomap,I.lightmap,I.emissivemap,I.bumpmap,I.normalmap,I.displacementmap,I.roughnessmap,I.metalnessmap,I.fog,I.lights,{emissive:{value:new L(0)},roughness:{value:1},metalness:{value:0},envMapIntensity:{value:1}}]),vertexShader:J.meshphysical_vert,fragmentShader:J.meshphysical_frag},toon:{uniforms:Ae([I.common,I.aomap,I.lightmap,I.emissivemap,I.bumpmap,I.normalmap,I.displacementmap,I.gradientmap,I.fog,I.lights,{emissive:{value:new L(0)}}]),vertexShader:J.meshtoon_vert,fragmentShader:J.meshtoon_frag},matcap:{uniforms:Ae([I.common,I.bumpmap,I.normalmap,I.displacementmap,I.fog,{matcap:{value:null}}]),vertexShader:J.meshmatcap_vert,fragmentShader:J.meshmatcap_frag},points:{uniforms:Ae([I.points,I.fog]),vertexShader:J.points_vert,fragmentShader:J.points_frag},dashed:{uniforms:Ae([I.common,I.fog,{scale:{value:1},dashSize:{value:1},totalSize:{value:2}}]),vertexShader:J.linedashed_vert,fragmentShader:J.linedashed_frag},depth:{uniforms:Ae([I.common,I.displacementmap]),vertexShader:J.depth_vert,fragmentShader:J.depth_frag},normal:{uniforms:Ae([I.common,I.bumpmap,I.normalmap,I.displacementmap,{opacity:{value:1}}]),vertexShader:J.meshnormal_vert,fragmentShader:J.meshnormal_frag},sprite:{uniforms:Ae([I.sprite,I.fog]),vertexShader:J.sprite_vert,fragmentShader:J.sprite_frag},background:{uniforms:{uvTransform:{value:new k},t2D:{value:null},backgroundIntensity:{value:1}},vertexShader:J.background_vert,fragmentShader:J.background_frag},backgroundCube:{uniforms:{envMap:{value:null},flipEnvMap:{value:-1},backgroundBlurriness:{value:0},backgroundIntensity:{value:1},backgroundRotation:{value:new k}},vertexShader:J.backgroundCube_vert,fragmentShader:J.backgroundCube_frag},cube:{uniforms:{tCube:{value:null},tFlip:{value:-1},opacity:{value:1}},vertexShader:J.cube_vert,fragmentShader:J.cube_frag},equirect:{uniforms:{tEquirect:{value:null}},vertexShader:J.equirect_vert,fragmentShader:J.equirect_frag},distanceRGBA:{uniforms:Ae([I.common,I.displacementmap,{referencePosition:{value:new M},nearDistance:{value:1},farDistance:{value:1e3}}]),vertexShader:J.distanceRGBA_vert,fragmentShader:J.distanceRGBA_frag},shadow:{uniforms:Ae([I.lights,I.fog,{color:{value:new L(0)},opacity:{value:1}}]),vertexShader:J.shadow_vert,fragmentShader:J.shadow_frag}};qa.physical={uniforms:Ae([qa.standard.uniforms,{clearcoat:{value:0},clearcoatMap:{value:null},clearcoatMapTransform:{value:new k},clearcoatNormalMap:{value:null},clearcoatNormalMapTransform:{value:new k},clearcoatNormalScale:{value:new Z(1,1)},clearcoatRoughness:{value:0},clearcoatRoughnessMap:{value:null},clearcoatRoughnessMapTransform:{value:new k},dispersion:{value:0},iridescence:{value:0},iridescenceMap:{value:null},iridescenceMapTransform:{value:new k},iridescenceIOR:{value:1.3},iridescenceThicknessMinimum:{value:100},iridescenceThicknessMaximum:{value:400},iridescenceThicknessMap:{value:null},iridescenceThicknessMapTransform:{value:new k},sheen:{value:0},sheenColor:{value:new L(0)},sheenColorMap:{value:null},sheenColorMapTransform:{value:new k},sheenRoughness:{value:1},sheenRoughnessMap:{value:null},sheenRoughnessMapTransform:{value:new k},transmission:{value:0},transmissionMap:{value:null},transmissionMapTransform:{value:new k},transmissionSamplerSize:{value:new Z},transmissionSamplerMap:{value:null},thickness:{value:0},thicknessMap:{value:null},thicknessMapTransform:{value:new k},attenuationDistance:{value:0},attenuationColor:{value:new L(0)},specularColor:{value:new L(1,1,1)},specularColorMap:{value:null},specularColorMapTransform:{value:new k},specularIntensity:{value:1},specularIntensityMap:{value:null},specularIntensityMapTransform:{value:new k},anisotropyVector:{value:new Z},anisotropyMap:{value:null},anisotropyMapTransform:{value:new k}}]),vertexShader:J.meshphysical_vert,fragmentShader:J.meshphysical_frag};var cn=(1+Math.sqrt(5))/2,On=1/cn,bx=[new M(-cn,On,0),new M(cn,On,0),new M(-On,0,cn),new M(On,0,cn),new M(0,cn,-On),new M(0,cn,On),new M(-1,1,-1),new M(1,1,-1),new M(-1,1,1),new M(1,1,1)];var wx=new Float32Array(16),Ax=new Float32Array(9),Ex=new Float32Array(4);var Rx={[wr]:Ar,[Er]:Ir,[Rr]:Pr,[$n]:Cr,[Ar]:wr,[Ir]:Er,[Pr]:Rr,[Cr]:$n};function zr(l,e){if(e===Nr)return console.warn("THREE.BufferGeometryUtils.toTrianglesDrawMode(): Geometry already defined as triangles."),l;if(e===Fn||e===_i){let t=l.getIndex();if(t===null){let r=[],o=l.getAttribute("position");if(o!==void 0){for(let a=0;a<o.count;a++)r.push(a);l.setIndex(r),t=l.getIndex()}else return console.error("THREE.BufferGeometryUtils.toTrianglesDrawMode(): Undefined position attribute. Processing not possible."),l}let n=t.count-2,i=[];if(e===Fn)for(let r=1;r<=n;r++)i.push(t.getX(0)),i.push(t.getX(r)),i.push(t.getX(r+1));else for(let r=0;r<n;r++)r%2===0?(i.push(t.getX(r)),i.push(t.getX(r+1)),i.push(t.getX(r+2))):(i.push(t.getX(r+2)),i.push(t.getX(r+1)),i.push(t.getX(r)));i.length/3!==n&&console.error("THREE.BufferGeometryUtils.toTrianglesDrawMode(): Unable to generate correct amount of triangles.");let s=l.clone();return s.setIndex(i),s.clearGroups(),s}else return console.error("THREE.BufferGeometryUtils.toTrianglesDrawMode(): Unknown draw mode:",e),l}var gs=class extends de{constructor(e){super(e),this.dracoLoader=null,this.ktx2Loader=null,this.meshoptDecoder=null,this.pluginCallbacks=[],this.register(function(t){return new qr(t)}),this.register(function(t){return new Yr(t)}),this.register(function(t){return new no(t)}),this.register(function(t){return new io(t)}),this.register(function(t){return new so(t)}),this.register(function(t){return new Zr(t)}),this.register(function(t){return new Jr(t)}),this.register(function(t){return new jr(t)}),this.register(function(t){return new $r(t)}),this.register(function(t){return new Xr(t)}),this.register(function(t){return new Qr(t)}),this.register(function(t){return new Kr(t)}),this.register(function(t){return new to(t)}),this.register(function(t){return new eo(t)}),this.register(function(t){return new Gr(t)}),this.register(function(t){return new ro(t)}),this.register(function(t){return new oo(t)})}load(e,t,n,i){let s=this,r;if(this.resourcePath!=="")r=this.resourcePath;else if(this.path!==""){let c=He.extractUrlBase(e);r=He.resolveURL(c,this.path)}else r=He.extractUrlBase(e);this.manager.itemStart(e);let o=function(c){i?i(c):console.error(c),s.manager.itemError(e),s.manager.itemEnd(e)},a=new ve(this.manager);a.setPath(this.path),a.setResponseType("arraybuffer"),a.setRequestHeader(this.requestHeader),a.setWithCredentials(this.withCredentials),a.load(e,function(c){try{s.parse(c,r,function(u){t(u),s.manager.itemEnd(e)},o)}catch(u){o(u)}},n,o)}setDRACOLoader(e){return this.dracoLoader=e,this}setKTX2Loader(e){return this.ktx2Loader=e,this}setMeshoptDecoder(e){return this.meshoptDecoder=e,this}register(e){return this.pluginCallbacks.indexOf(e)===-1&&this.pluginCallbacks.push(e),this}unregister(e){return this.pluginCallbacks.indexOf(e)!==-1&&this.pluginCallbacks.splice(this.pluginCallbacks.indexOf(e),1),this}parse(e,t,n,i){let s,r={},o={},a=new TextDecoder;if(typeof e=="string")s=JSON.parse(e);else if(e instanceof ArrayBuffer)if(a.decode(new Uint8Array(e,0,4))===$a){try{r[q.KHR_BINARY_GLTF]=new ao(e)}catch(h){i&&i(h);return}s=JSON.parse(r[q.KHR_BINARY_GLTF].content)}else s=JSON.parse(a.decode(e));else s=e;if(s.asset===void 0||s.asset.version[0]<2){i&&i(new Error("THREE.GLTFLoader: Unsupported asset. glTF versions >=2.0 are supported."));return}let c=new mo(s,{path:t||this.resourcePath||"",crossOrigin:this.crossOrigin,requestHeader:this.requestHeader,manager:this.manager,ktx2Loader:this.ktx2Loader,meshoptDecoder:this.meshoptDecoder});c.fileLoader.setRequestHeader(this.requestHeader);for(let u=0;u<this.pluginCallbacks.length;u++){let h=this.pluginCallbacks[u](c);h.name||console.error("THREE.GLTFLoader: Invalid plugin found: missing name"),o[h.name]=h,r[h.name]=!0}if(s.extensionsUsed)for(let u=0;u<s.extensionsUsed.length;++u){let h=s.extensionsUsed[u],f=s.extensionsRequired||[];switch(h){case q.KHR_MATERIALS_UNLIT:r[h]=new Wr;break;case q.KHR_DRACO_MESH_COMPRESSION:r[h]=new co(s,this.dracoLoader);break;case q.KHR_TEXTURE_TRANSFORM:r[h]=new lo;break;case q.KHR_MESH_QUANTIZATION:r[h]=new ho;break;default:f.indexOf(h)>=0&&o[h]===void 0&&console.warn('THREE.GLTFLoader: Unknown extension "'+h+'".')}}c.setExtensions(r),c.setPlugins(o),c.parse(n,i)}parseAsync(e,t){let n=this;return new Promise(function(i,s){n.parse(e,t,i,s)})}};function pf(){let l={};return{get:function(e){return l[e]},add:function(e,t){l[e]=t},remove:function(e){delete l[e]},removeAll:function(){l={}}}}var q={KHR_BINARY_GLTF:"KHR_binary_glTF",KHR_DRACO_MESH_COMPRESSION:"KHR_draco_mesh_compression",KHR_LIGHTS_PUNCTUAL:"KHR_lights_punctual",KHR_MATERIALS_CLEARCOAT:"KHR_materials_clearcoat",KHR_MATERIALS_DISPERSION:"KHR_materials_dispersion",KHR_MATERIALS_IOR:"KHR_materials_ior",KHR_MATERIALS_SHEEN:"KHR_materials_sheen",KHR_MATERIALS_SPECULAR:"KHR_materials_specular",KHR_MATERIALS_TRANSMISSION:"KHR_materials_transmission",KHR_MATERIALS_IRIDESCENCE:"KHR_materials_iridescence",KHR_MATERIALS_ANISOTROPY:"KHR_materials_anisotropy",KHR_MATERIALS_UNLIT:"KHR_materials_unlit",KHR_MATERIALS_VOLUME:"KHR_materials_volume",KHR_TEXTURE_BASISU:"KHR_texture_basisu",KHR_TEXTURE_TRANSFORM:"KHR_texture_transform",KHR_MESH_QUANTIZATION:"KHR_mesh_quantization",KHR_MATERIALS_EMISSIVE_STRENGTH:"KHR_materials_emissive_strength",EXT_MATERIALS_BUMP:"EXT_materials_bump",EXT_TEXTURE_WEBP:"EXT_texture_webp",EXT_TEXTURE_AVIF:"EXT_texture_avif",EXT_MESHOPT_COMPRESSION:"EXT_meshopt_compression",EXT_MESH_GPU_INSTANCING:"EXT_mesh_gpu_instancing"},Gr=class{constructor(e){this.parser=e,this.name=q.KHR_LIGHTS_PUNCTUAL,this.cache={refs:{},uses:{}}}_markDefs(){let e=this.parser,t=this.parser.json.nodes||[];for(let n=0,i=t.length;n<i;n++){let s=t[n];s.extensions&&s.extensions[this.name]&&s.extensions[this.name].light!==void 0&&e._addNodeRef(this.cache,s.extensions[this.name].light)}}_loadLight(e){let t=this.parser,n="light:"+e,i=t.cache.get(n);if(i)return i;let s=t.json,a=((s.extensions&&s.extensions[this.name]||{}).lights||[])[e],c,u=new L(16777215);a.color!==void 0&&u.setRGB(a.color[0],a.color[1],a.color[2],ze);let h=a.range!==void 0?a.range:0;switch(a.type){case"directional":c=new an(u),c.target.position.set(0,0,-1),c.add(c.target);break;case"point":c=new Gt(u),c.distance=h;break;case"spot":c=new on(u),c.distance=h,a.spot=a.spot||{},a.spot.innerConeAngle=a.spot.innerConeAngle!==void 0?a.spot.innerConeAngle:0,a.spot.outerConeAngle=a.spot.outerConeAngle!==void 0?a.spot.outerConeAngle:Math.PI/4,c.angle=a.spot.outerConeAngle,c.penumbra=1-a.spot.innerConeAngle/a.spot.outerConeAngle,c.target.position.set(0,0,-1),c.add(c.target);break;default:throw new Error("THREE.GLTFLoader: Unexpected light type: "+a.type)}return c.position.set(0,0,0),ut(c,a),a.intensity!==void 0&&(c.intensity=a.intensity),c.name=t.createUniqueName(a.name||"light_"+e),i=Promise.resolve(c),t.cache.add(n,i),i}getDependency(e,t){if(e==="light")return this._loadLight(t)}createNodeAttachment(e){let t=this,n=this.parser,s=n.json.nodes[e],o=(s.extensions&&s.extensions[this.name]||{}).light;return o===void 0?null:this._loadLight(o).then(function(a){return n._getNodeRef(t.cache,o,a)})}},Wr=class{constructor(){this.name=q.KHR_MATERIALS_UNLIT}getMaterialType(){return ct}extendParams(e,t,n){let i=[];e.color=new L(1,1,1),e.opacity=1;let s=t.pbrMetallicRoughness;if(s){if(Array.isArray(s.baseColorFactor)){let r=s.baseColorFactor;e.color.setRGB(r[0],r[1],r[2],ze),e.opacity=r[3]}s.baseColorTexture!==void 0&&i.push(n.assignTexture(e,"map",s.baseColorTexture,O))}return Promise.all(i)}},Xr=class{constructor(e){this.parser=e,this.name=q.KHR_MATERIALS_EMISSIVE_STRENGTH}extendMaterialParams(e,t){let i=this.parser.json.materials[e];if(!i.extensions||!i.extensions[this.name])return Promise.resolve();let s=i.extensions[this.name].emissiveStrength;return s!==void 0&&(t.emissiveIntensity=s),Promise.resolve()}},qr=class{constructor(e){this.parser=e,this.name=q.KHR_MATERIALS_CLEARCOAT}getMaterialType(e){let n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:De}extendMaterialParams(e,t){let n=this.parser,i=n.json.materials[e];if(!i.extensions||!i.extensions[this.name])return Promise.resolve();let s=[],r=i.extensions[this.name];if(r.clearcoatFactor!==void 0&&(t.clearcoat=r.clearcoatFactor),r.clearcoatTexture!==void 0&&s.push(n.assignTexture(t,"clearcoatMap",r.clearcoatTexture)),r.clearcoatRoughnessFactor!==void 0&&(t.clearcoatRoughness=r.clearcoatRoughnessFactor),r.clearcoatRoughnessTexture!==void 0&&s.push(n.assignTexture(t,"clearcoatRoughnessMap",r.clearcoatRoughnessTexture)),r.clearcoatNormalTexture!==void 0&&(s.push(n.assignTexture(t,"clearcoatNormalMap",r.clearcoatNormalTexture)),r.clearcoatNormalTexture.scale!==void 0)){let o=r.clearcoatNormalTexture.scale;t.clearcoatNormalScale=new Z(o,o)}return Promise.all(s)}},Yr=class{constructor(e){this.parser=e,this.name=q.KHR_MATERIALS_DISPERSION}getMaterialType(e){let n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:De}extendMaterialParams(e,t){let i=this.parser.json.materials[e];if(!i.extensions||!i.extensions[this.name])return Promise.resolve();let s=i.extensions[this.name];return t.dispersion=s.dispersion!==void 0?s.dispersion:0,Promise.resolve()}},Kr=class{constructor(e){this.parser=e,this.name=q.KHR_MATERIALS_IRIDESCENCE}getMaterialType(e){let n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:De}extendMaterialParams(e,t){let n=this.parser,i=n.json.materials[e];if(!i.extensions||!i.extensions[this.name])return Promise.resolve();let s=[],r=i.extensions[this.name];return r.iridescenceFactor!==void 0&&(t.iridescence=r.iridescenceFactor),r.iridescenceTexture!==void 0&&s.push(n.assignTexture(t,"iridescenceMap",r.iridescenceTexture)),r.iridescenceIor!==void 0&&(t.iridescenceIOR=r.iridescenceIor),t.iridescenceThicknessRange===void 0&&(t.iridescenceThicknessRange=[100,400]),r.iridescenceThicknessMinimum!==void 0&&(t.iridescenceThicknessRange[0]=r.iridescenceThicknessMinimum),r.iridescenceThicknessMaximum!==void 0&&(t.iridescenceThicknessRange[1]=r.iridescenceThicknessMaximum),r.iridescenceThicknessTexture!==void 0&&s.push(n.assignTexture(t,"iridescenceThicknessMap",r.iridescenceThicknessTexture)),Promise.all(s)}},Zr=class{constructor(e){this.parser=e,this.name=q.KHR_MATERIALS_SHEEN}getMaterialType(e){let n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:De}extendMaterialParams(e,t){let n=this.parser,i=n.json.materials[e];if(!i.extensions||!i.extensions[this.name])return Promise.resolve();let s=[];t.sheenColor=new L(0,0,0),t.sheenRoughness=0,t.sheen=1;let r=i.extensions[this.name];if(r.sheenColorFactor!==void 0){let o=r.sheenColorFactor;t.sheenColor.setRGB(o[0],o[1],o[2],ze)}return r.sheenRoughnessFactor!==void 0&&(t.sheenRoughness=r.sheenRoughnessFactor),r.sheenColorTexture!==void 0&&s.push(n.assignTexture(t,"sheenColorMap",r.sheenColorTexture,O)),r.sheenRoughnessTexture!==void 0&&s.push(n.assignTexture(t,"sheenRoughnessMap",r.sheenRoughnessTexture)),Promise.all(s)}},Jr=class{constructor(e){this.parser=e,this.name=q.KHR_MATERIALS_TRANSMISSION}getMaterialType(e){let n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:De}extendMaterialParams(e,t){let n=this.parser,i=n.json.materials[e];if(!i.extensions||!i.extensions[this.name])return Promise.resolve();let s=[],r=i.extensions[this.name];return r.transmissionFactor!==void 0&&(t.transmission=r.transmissionFactor),r.transmissionTexture!==void 0&&s.push(n.assignTexture(t,"transmissionMap",r.transmissionTexture)),Promise.all(s)}},jr=class{constructor(e){this.parser=e,this.name=q.KHR_MATERIALS_VOLUME}getMaterialType(e){let n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:De}extendMaterialParams(e,t){let n=this.parser,i=n.json.materials[e];if(!i.extensions||!i.extensions[this.name])return Promise.resolve();let s=[],r=i.extensions[this.name];t.thickness=r.thicknessFactor!==void 0?r.thicknessFactor:0,r.thicknessTexture!==void 0&&s.push(n.assignTexture(t,"thicknessMap",r.thicknessTexture)),t.attenuationDistance=r.attenuationDistance||1/0;let o=r.attenuationColor||[1,1,1];return t.attenuationColor=new L().setRGB(o[0],o[1],o[2],ze),Promise.all(s)}},$r=class{constructor(e){this.parser=e,this.name=q.KHR_MATERIALS_IOR}getMaterialType(e){let n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:De}extendMaterialParams(e,t){let i=this.parser.json.materials[e];if(!i.extensions||!i.extensions[this.name])return Promise.resolve();let s=i.extensions[this.name];return t.ior=s.ior!==void 0?s.ior:1.5,Promise.resolve()}},Qr=class{constructor(e){this.parser=e,this.name=q.KHR_MATERIALS_SPECULAR}getMaterialType(e){let n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:De}extendMaterialParams(e,t){let n=this.parser,i=n.json.materials[e];if(!i.extensions||!i.extensions[this.name])return Promise.resolve();let s=[],r=i.extensions[this.name];t.specularIntensity=r.specularFactor!==void 0?r.specularFactor:1,r.specularTexture!==void 0&&s.push(n.assignTexture(t,"specularIntensityMap",r.specularTexture));let o=r.specularColorFactor||[1,1,1];return t.specularColor=new L().setRGB(o[0],o[1],o[2],ze),r.specularColorTexture!==void 0&&s.push(n.assignTexture(t,"specularColorMap",r.specularColorTexture,O)),Promise.all(s)}},eo=class{constructor(e){this.parser=e,this.name=q.EXT_MATERIALS_BUMP}getMaterialType(e){let n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:De}extendMaterialParams(e,t){let n=this.parser,i=n.json.materials[e];if(!i.extensions||!i.extensions[this.name])return Promise.resolve();let s=[],r=i.extensions[this.name];return t.bumpScale=r.bumpFactor!==void 0?r.bumpFactor:1,r.bumpTexture!==void 0&&s.push(n.assignTexture(t,"bumpMap",r.bumpTexture)),Promise.all(s)}},to=class{constructor(e){this.parser=e,this.name=q.KHR_MATERIALS_ANISOTROPY}getMaterialType(e){let n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:De}extendMaterialParams(e,t){let n=this.parser,i=n.json.materials[e];if(!i.extensions||!i.extensions[this.name])return Promise.resolve();let s=[],r=i.extensions[this.name];return r.anisotropyStrength!==void 0&&(t.anisotropy=r.anisotropyStrength),r.anisotropyRotation!==void 0&&(t.anisotropyRotation=r.anisotropyRotation),r.anisotropyTexture!==void 0&&s.push(n.assignTexture(t,"anisotropyMap",r.anisotropyTexture)),Promise.all(s)}},no=class{constructor(e){this.parser=e,this.name=q.KHR_TEXTURE_BASISU}loadTexture(e){let t=this.parser,n=t.json,i=n.textures[e];if(!i.extensions||!i.extensions[this.name])return null;let s=i.extensions[this.name],r=t.options.ktx2Loader;if(!r){if(n.extensionsRequired&&n.extensionsRequired.indexOf(this.name)>=0)throw new Error("THREE.GLTFLoader: setKTX2Loader must be called before loading KTX2 textures");return null}return t.loadTextureImage(e,s.source,r)}},io=class{constructor(e){this.parser=e,this.name=q.EXT_TEXTURE_WEBP}loadTexture(e){let t=this.name,n=this.parser,i=n.json,s=i.textures[e];if(!s.extensions||!s.extensions[t])return null;let r=s.extensions[t],o=i.images[r.source],a=n.textureLoader;if(o.uri){let c=n.options.manager.getHandler(o.uri);c!==null&&(a=c)}return n.loadTextureImage(e,r.source,a)}},so=class{constructor(e){this.parser=e,this.name=q.EXT_TEXTURE_AVIF}loadTexture(e){let t=this.name,n=this.parser,i=n.json,s=i.textures[e];if(!s.extensions||!s.extensions[t])return null;let r=s.extensions[t],o=i.images[r.source],a=n.textureLoader;if(o.uri){let c=n.options.manager.getHandler(o.uri);c!==null&&(a=c)}return n.loadTextureImage(e,r.source,a)}},ro=class{constructor(e){this.name=q.EXT_MESHOPT_COMPRESSION,this.parser=e}loadBufferView(e){let t=this.parser.json,n=t.bufferViews[e];if(n.extensions&&n.extensions[this.name]){let i=n.extensions[this.name],s=this.parser.getDependency("buffer",i.buffer),r=this.parser.options.meshoptDecoder;if(!r||!r.supported){if(t.extensionsRequired&&t.extensionsRequired.indexOf(this.name)>=0)throw new Error("THREE.GLTFLoader: setMeshoptDecoder must be called before loading compressed files");return null}return s.then(function(o){let a=i.byteOffset||0,c=i.byteLength||0,u=i.count,h=i.byteStride,f=new Uint8Array(o,a,c);return r.decodeGltfBufferAsync?r.decodeGltfBufferAsync(u,h,f,i.mode,i.filter).then(function(d){return d.buffer}):r.ready.then(function(){let d=new ArrayBuffer(u*h);return r.decodeGltfBuffer(new Uint8Array(d),u,h,f,i.mode,i.filter),d})})}else return null}},oo=class{constructor(e){this.name=q.EXT_MESH_GPU_INSTANCING,this.parser=e}createNodeMesh(e){let t=this.parser.json,n=t.nodes[e];if(!n.extensions||!n.extensions[this.name]||n.mesh===void 0)return null;let i=t.meshes[n.mesh];for(let c of i.primitives)if(c.mode!==Ze.TRIANGLES&&c.mode!==Ze.TRIANGLE_STRIP&&c.mode!==Ze.TRIANGLE_FAN&&c.mode!==void 0)return null;let r=n.extensions[this.name].attributes,o=[],a={};for(let c in r)o.push(this.parser.getDependency("accessor",r[c]).then(u=>(a[c]=u,a[c])));return o.length<1?null:(o.push(this.parser.createNodeMesh(e)),Promise.all(o).then(c=>{let u=c.pop(),h=u.isGroup?u.children:[u],f=c[0].count,d=[];for(let p of h){let g=new D,m=new M,x=new fe,v=new M(1,1,1),y=new ei(p.geometry,p.material,f);for(let _=0;_<f;_++)a.TRANSLATION&&m.fromBufferAttribute(a.TRANSLATION,_),a.ROTATION&&x.fromBufferAttribute(a.ROTATION,_),a.SCALE&&v.fromBufferAttribute(a.SCALE,_),y.setMatrixAt(_,g.compose(m,x,v));for(let _ in a)if(_==="_COLOR_0"){let S=a[_];y.instanceColor=new Vt(S.array,S.itemSize,S.normalized)}else _!=="TRANSLATION"&&_!=="ROTATION"&&_!=="SCALE"&&p.geometry.setAttribute(_,a[_]);oe.prototype.copy.call(y,p),this.parser.assignFinalMaterial(y),d.push(y)}return u.isGroup?(u.clear(),u.add(...d),u):d[0]}))}},$a="glTF",vi=12,Ka={JSON:1313821514,BIN:5130562},ao=class{constructor(e){this.name=q.KHR_BINARY_GLTF,this.content=null,this.body=null;let t=new DataView(e,0,vi),n=new TextDecoder;if(this.header={magic:n.decode(new Uint8Array(e.slice(0,4))),version:t.getUint32(4,!0),length:t.getUint32(8,!0)},this.header.magic!==$a)throw new Error("THREE.GLTFLoader: Unsupported glTF-Binary header.");if(this.header.version<2)throw new Error("THREE.GLTFLoader: Legacy binary file detected.");let i=this.header.length-vi,s=new DataView(e,vi),r=0;for(;r<i;){let o=s.getUint32(r,!0);r+=4;let a=s.getUint32(r,!0);if(r+=4,a===Ka.JSON){let c=new Uint8Array(e,vi+r,o);this.content=n.decode(c)}else if(a===Ka.BIN){let c=vi+r;this.body=e.slice(c,c+o)}r+=o}if(this.content===null)throw new Error("THREE.GLTFLoader: JSON content not found.")}},co=class{constructor(e,t){if(!t)throw new Error("THREE.GLTFLoader: No DRACOLoader instance provided.");this.name=q.KHR_DRACO_MESH_COMPRESSION,this.json=e,this.dracoLoader=t,this.dracoLoader.preload()}decodePrimitive(e,t){let n=this.json,i=this.dracoLoader,s=e.extensions[this.name].bufferView,r=e.extensions[this.name].attributes,o={},a={},c={};for(let u in r){let h=fo[u]||u.toLowerCase();o[h]=r[u]}for(let u in e.attributes){let h=fo[u]||u.toLowerCase();if(r[u]!==void 0){let f=n.accessors[e.attributes[u]],d=Bn[f.componentType];c[h]=d.name,a[h]=f.normalized===!0}}return t.getDependency("bufferView",s).then(function(u){return new Promise(function(h,f){i.decodeDracoFile(u,function(d){for(let p in d.attributes){let g=d.attributes[p],m=a[p];m!==void 0&&(g.normalized=m)}h(d)},o,c,ze,f)})})}},lo=class{constructor(){this.name=q.KHR_TEXTURE_TRANSFORM}extendTexture(e,t){return(t.texCoord===void 0||t.texCoord===e.channel)&&t.offset===void 0&&t.rotation===void 0&&t.scale===void 0||(e=e.clone(),t.texCoord!==void 0&&(e.channel=t.texCoord),t.offset!==void 0&&e.offset.fromArray(t.offset),t.rotation!==void 0&&(e.rotation=t.rotation),t.scale!==void 0&&e.repeat.fromArray(t.scale),e.needsUpdate=!0),e}},ho=class{constructor(){this.name=q.KHR_MESH_QUANTIZATION}},xs=class extends At{constructor(e,t,n,i){super(e,t,n,i)}copySampleValue_(e){let t=this.resultBuffer,n=this.sampleValues,i=this.valueSize,s=e*i*3+i;for(let r=0;r!==i;r++)t[r]=n[s+r];return t}interpolate_(e,t,n,i){let s=this.resultBuffer,r=this.sampleValues,o=this.valueSize,a=o*2,c=o*3,u=i-t,h=(n-t)/u,f=h*h,d=f*h,p=e*c,g=p-c,m=-2*d+3*f,x=d-f,v=1-m,y=x-f+h;for(let _=0;_!==o;_++){let S=r[g+_+o],T=r[g+_+a]*u,b=r[p+_+o],w=r[p+_]*u;s[_]=v*S+y*T+m*b+x*w}return s}},mf=new fe,uo=class extends xs{interpolate_(e,t,n,i){let s=super.interpolate_(e,t,n,i);return mf.fromArray(s).normalize().toArray(s),s}},Ze={FLOAT:5126,FLOAT_MAT3:35675,FLOAT_MAT4:35676,FLOAT_VEC2:35664,FLOAT_VEC3:35665,FLOAT_VEC4:35666,LINEAR:9729,REPEAT:10497,SAMPLER_2D:35678,POINTS:0,LINES:1,LINE_LOOP:2,LINE_STRIP:3,TRIANGLES:4,TRIANGLE_STRIP:5,TRIANGLE_FAN:6,UNSIGNED_BYTE:5121,UNSIGNED_SHORT:5123},Bn={5120:Int8Array,5121:Uint8Array,5122:Int16Array,5123:Uint16Array,5125:Uint32Array,5126:Float32Array},Za={9728:kt,9729:nt,9984:pi,9985:gi,9986:mi,9987:ht},Ja={33071:Re,33648:Jt,10497:Ce},kr={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT2:4,MAT3:9,MAT4:16},fo={POSITION:"position",NORMAL:"normal",TANGENT:"tangent",TEXCOORD_0:"uv",TEXCOORD_1:"uv1",TEXCOORD_2:"uv2",TEXCOORD_3:"uv3",COLOR_0:"color",WEIGHTS_0:"skinWeight",JOINTS_0:"skinIndex"},Wt={scale:"scale",translation:"position",rotation:"quaternion",weights:"morphTargetInfluences"},gf={CUBICSPLINE:void 0,LINEAR:Mt,STEP:vt},Vr={OPAQUE:"OPAQUE",MASK:"MASK",BLEND:"BLEND"};function xf(l){return l.DefaultMaterial===void 0&&(l.DefaultMaterial=new lt({color:16777215,emissive:0,metalness:1,roughness:1,transparent:!1,depthTest:!0,side:zt})),l.DefaultMaterial}function ln(l,e,t){for(let n in t.extensions)l[n]===void 0&&(e.userData.gltfExtensions=e.userData.gltfExtensions||{},e.userData.gltfExtensions[n]=t.extensions[n])}function ut(l,e){e.extras!==void 0&&(typeof e.extras=="object"?Object.assign(l.userData,e.extras):console.warn("THREE.GLTFLoader: Ignoring primitive type .extras, "+e.extras))}function _f(l,e,t){let n=!1,i=!1,s=!1;for(let c=0,u=e.length;c<u;c++){let h=e[c];if(h.POSITION!==void 0&&(n=!0),h.NORMAL!==void 0&&(i=!0),h.COLOR_0!==void 0&&(s=!0),n&&i&&s)break}if(!n&&!i&&!s)return Promise.resolve(l);let r=[],o=[],a=[];for(let c=0,u=e.length;c<u;c++){let h=e[c];if(n){let f=h.POSITION!==void 0?t.getDependency("accessor",h.POSITION):l.attributes.position;r.push(f)}if(i){let f=h.NORMAL!==void 0?t.getDependency("accessor",h.NORMAL):l.attributes.normal;o.push(f)}if(s){let f=h.COLOR_0!==void 0?t.getDependency("accessor",h.COLOR_0):l.attributes.color;a.push(f)}}return Promise.all([Promise.all(r),Promise.all(o),Promise.all(a)]).then(function(c){let u=c[0],h=c[1],f=c[2];return n&&(l.morphAttributes.position=u),i&&(l.morphAttributes.normal=h),s&&(l.morphAttributes.color=f),l.morphTargetsRelative=!0,l})}function yf(l,e){if(l.updateMorphTargets(),e.weights!==void 0)for(let t=0,n=e.weights.length;t<n;t++)l.morphTargetInfluences[t]=e.weights[t];if(e.extras&&Array.isArray(e.extras.targetNames)){let t=e.extras.targetNames;if(l.morphTargetInfluences.length===t.length){l.morphTargetDictionary={};for(let n=0,i=t.length;n<i;n++)l.morphTargetDictionary[t[n]]=n}else console.warn("THREE.GLTFLoader: Invalid extras.targetNames length. Ignoring names.")}}function vf(l){let e,t=l.extensions&&l.extensions[q.KHR_DRACO_MESH_COMPRESSION];if(t?e="draco:"+t.bufferView+":"+t.indices+":"+Hr(t.attributes):e=l.indices+":"+Hr(l.attributes)+":"+l.mode,l.targets!==void 0)for(let n=0,i=l.targets.length;n<i;n++)e+=":"+Hr(l.targets[n]);return e}function Hr(l){let e="",t=Object.keys(l).sort();for(let n=0,i=t.length;n<i;n++)e+=t[n]+":"+l[t[n]]+";";return e}function po(l){switch(l){case Int8Array:return 1/127;case Uint8Array:return 1/255;case Int16Array:return 1/32767;case Uint16Array:return 1/65535;default:throw new Error("THREE.GLTFLoader: Unsupported normalized accessor component type.")}}function Mf(l){return l.search(/\.jpe?g($|\?)/i)>0||l.search(/^data\:image\/jpeg/)===0?"image/jpeg":l.search(/\.webp($|\?)/i)>0||l.search(/^data\:image\/webp/)===0?"image/webp":l.search(/\.ktx2($|\?)/i)>0||l.search(/^data\:image\/ktx2/)===0?"image/ktx2":"image/png"}var Sf=new D,mo=class{constructor(e={},t={}){this.json=e,this.extensions={},this.plugins={},this.options=t,this.cache=new pf,this.associations=new Map,this.primitiveCache={},this.nodeCache={},this.meshCache={refs:{},uses:{}},this.cameraCache={refs:{},uses:{}},this.lightCache={refs:{},uses:{}},this.sourceCache={},this.textureCache={},this.nodeNamesUsed={};let n=!1,i=-1,s=!1,r=-1;if(typeof navigator<"u"){let o=navigator.userAgent;n=/^((?!chrome|android).)*safari/i.test(o)===!0;let a=o.match(/Version\/(\d+)/);i=n&&a?parseInt(a[1],10):-1,s=o.indexOf("Firefox")>-1,r=s?o.match(/Firefox\/([0-9]+)\./)[1]:-1}typeof createImageBitmap>"u"||n&&i<17||s&&r<98?this.textureLoader=new Ct(this.options.manager):this.textureLoader=new fi(this.options.manager),this.textureLoader.setCrossOrigin(this.options.crossOrigin),this.textureLoader.setRequestHeader(this.options.requestHeader),this.fileLoader=new ve(this.options.manager),this.fileLoader.setResponseType("arraybuffer"),this.options.crossOrigin==="use-credentials"&&this.fileLoader.setWithCredentials(!0)}setExtensions(e){this.extensions=e}setPlugins(e){this.plugins=e}parse(e,t){let n=this,i=this.json,s=this.extensions;this.cache.removeAll(),this.nodeCache={},this._invokeAll(function(r){return r._markDefs&&r._markDefs()}),Promise.all(this._invokeAll(function(r){return r.beforeRoot&&r.beforeRoot()})).then(function(){return Promise.all([n.getDependencies("scene"),n.getDependencies("animation"),n.getDependencies("camera")])}).then(function(r){let o={scene:r[0][i.scene||0],scenes:r[0],animations:r[1],cameras:r[2],asset:i.asset,parser:n,userData:{}};return ln(s,o,i),ut(o,i),Promise.all(n._invokeAll(function(a){return a.afterRoot&&a.afterRoot(o)})).then(function(){for(let a of o.scenes)a.updateMatrixWorld();e(o)})}).catch(t)}_markDefs(){let e=this.json.nodes||[],t=this.json.skins||[],n=this.json.meshes||[];for(let i=0,s=t.length;i<s;i++){let r=t[i].joints;for(let o=0,a=r.length;o<a;o++)e[r[o]].isBone=!0}for(let i=0,s=e.length;i<s;i++){let r=e[i];r.mesh!==void 0&&(this._addNodeRef(this.meshCache,r.mesh),r.skin!==void 0&&(n[r.mesh].isSkinnedMesh=!0)),r.camera!==void 0&&this._addNodeRef(this.cameraCache,r.camera)}}_addNodeRef(e,t){t!==void 0&&(e.refs[t]===void 0&&(e.refs[t]=e.uses[t]=0),e.refs[t]++)}_getNodeRef(e,t,n){if(e.refs[t]<=1)return n;let i=n.clone(),s=(r,o)=>{let a=this.associations.get(r);a!=null&&this.associations.set(o,a);for(let[c,u]of r.children.entries())s(u,o.children[c])};return s(n,i),i.name+="_instance_"+e.uses[t]++,i}_invokeOne(e){let t=Object.values(this.plugins);t.push(this);for(let n=0;n<t.length;n++){let i=e(t[n]);if(i)return i}return null}_invokeAll(e){let t=Object.values(this.plugins);t.unshift(this);let n=[];for(let i=0;i<t.length;i++){let s=e(t[i]);s&&n.push(s)}return n}getDependency(e,t){let n=e+":"+t,i=this.cache.get(n);if(!i){switch(e){case"scene":i=this.loadScene(t);break;case"node":i=this._invokeOne(function(s){return s.loadNode&&s.loadNode(t)});break;case"mesh":i=this._invokeOne(function(s){return s.loadMesh&&s.loadMesh(t)});break;case"accessor":i=this.loadAccessor(t);break;case"bufferView":i=this._invokeOne(function(s){return s.loadBufferView&&s.loadBufferView(t)});break;case"buffer":i=this.loadBuffer(t);break;case"material":i=this._invokeOne(function(s){return s.loadMaterial&&s.loadMaterial(t)});break;case"texture":i=this._invokeOne(function(s){return s.loadTexture&&s.loadTexture(t)});break;case"skin":i=this.loadSkin(t);break;case"animation":i=this._invokeOne(function(s){return s.loadAnimation&&s.loadAnimation(t)});break;case"camera":i=this.loadCamera(t);break;default:if(i=this._invokeOne(function(s){return s!=this&&s.getDependency&&s.getDependency(e,t)}),!i)throw new Error("Unknown type: "+e);break}this.cache.add(n,i)}return i}getDependencies(e){let t=this.cache.get(e);if(!t){let n=this,i=this.json[e+(e==="mesh"?"es":"s")]||[];t=Promise.all(i.map(function(s,r){return n.getDependency(e,r)})),this.cache.add(e,t)}return t}loadBuffer(e){let t=this.json.buffers[e],n=this.fileLoader;if(t.type&&t.type!=="arraybuffer")throw new Error("THREE.GLTFLoader: "+t.type+" buffer type is not supported.");if(t.uri===void 0&&e===0)return Promise.resolve(this.extensions[q.KHR_BINARY_GLTF].body);let i=this.options;return new Promise(function(s,r){n.load(He.resolveURL(t.uri,i.path),s,void 0,function(){r(new Error('THREE.GLTFLoader: Failed to load buffer "'+t.uri+'".'))})})}loadBufferView(e){let t=this.json.bufferViews[e];return this.getDependency("buffer",t.buffer).then(function(n){let i=t.byteLength||0,s=t.byteOffset||0;return n.slice(s,s+i)})}loadAccessor(e){let t=this,n=this.json,i=this.json.accessors[e];if(i.bufferView===void 0&&i.sparse===void 0){let r=kr[i.type],o=Bn[i.componentType],a=i.normalized===!0,c=new o(i.count*r);return Promise.resolve(new se(c,r,a))}let s=[];return i.bufferView!==void 0?s.push(this.getDependency("bufferView",i.bufferView)):s.push(null),i.sparse!==void 0&&(s.push(this.getDependency("bufferView",i.sparse.indices.bufferView)),s.push(this.getDependency("bufferView",i.sparse.values.bufferView))),Promise.all(s).then(function(r){let o=r[0],a=kr[i.type],c=Bn[i.componentType],u=c.BYTES_PER_ELEMENT,h=u*a,f=i.byteOffset||0,d=i.bufferView!==void 0?n.bufferViews[i.bufferView].byteStride:void 0,p=i.normalized===!0,g,m;if(d&&d!==h){let x=Math.floor(f/d),v="InterleavedBuffer:"+i.bufferView+":"+i.componentType+":"+x+":"+i.count,y=t.cache.get(v);y||(g=new c(o,x*d,i.count*d/u),y=new In(g,d/u),t.cache.add(v,y)),m=new Pn(y,a,f%d/u,p)}else o===null?g=new c(i.count*a):g=new c(o,f,i.count*a),m=new se(g,a,p);if(i.sparse!==void 0){let x=kr.SCALAR,v=Bn[i.sparse.indices.componentType],y=i.sparse.indices.byteOffset||0,_=i.sparse.values.byteOffset||0,S=new v(r[1],y,i.sparse.count*x),T=new c(r[2],_,i.sparse.count*a);o!==null&&(m=new se(m.array.slice(),m.itemSize,m.normalized)),m.normalized=!1;for(let b=0,w=S.length;b<w;b++){let E=S[b];if(m.setX(E,T[b*a]),a>=2&&m.setY(E,T[b*a+1]),a>=3&&m.setZ(E,T[b*a+2]),a>=4&&m.setW(E,T[b*a+3]),a>=5)throw new Error("THREE.GLTFLoader: Unsupported itemSize in sparse BufferAttribute.")}m.normalized=p}return m})}loadTexture(e){let t=this.json,n=this.options,s=t.textures[e].source,r=t.images[s],o=this.textureLoader;if(r.uri){let a=n.manager.getHandler(r.uri);a!==null&&(o=a)}return this.loadTextureImage(e,s,o)}loadTextureImage(e,t,n){let i=this,s=this.json,r=s.textures[e],o=s.images[t],a=(o.uri||o.bufferView)+":"+r.sampler;if(this.textureCache[a])return this.textureCache[a];let c=this.loadImageSource(t,n).then(function(u){u.flipY=!1,u.name=r.name||o.name||"",u.name===""&&typeof o.uri=="string"&&o.uri.startsWith("data:image/")===!1&&(u.name=o.uri);let f=(s.samplers||{})[r.sampler]||{};return u.magFilter=Za[f.magFilter]||nt,u.minFilter=Za[f.minFilter]||ht,u.wrapS=Ja[f.wrapS]||Ce,u.wrapT=Ja[f.wrapT]||Ce,u.generateMipmaps=!u.isCompressedTexture&&u.minFilter!==kt&&u.minFilter!==nt,i.associations.set(u,{textures:e}),u}).catch(function(){return null});return this.textureCache[a]=c,c}loadImageSource(e,t){let n=this,i=this.json,s=this.options;if(this.sourceCache[e]!==void 0)return this.sourceCache[e].then(h=>h.clone());let r=i.images[e],o=self.URL||self.webkitURL,a=r.uri||"",c=!1;if(r.bufferView!==void 0)a=n.getDependency("bufferView",r.bufferView).then(function(h){c=!0;let f=new Blob([h],{type:r.mimeType});return a=o.createObjectURL(f),a});else if(r.uri===void 0)throw new Error("THREE.GLTFLoader: Image "+e+" is missing URI and bufferView");let u=Promise.resolve(a).then(function(h){return new Promise(function(f,d){let p=f;t.isImageBitmapLoader===!0&&(p=function(g){let m=new Ie(g);m.needsUpdate=!0,f(m)}),t.load(He.resolveURL(h,s.path),p,void 0,d)})}).then(function(h){return c===!0&&o.revokeObjectURL(a),ut(h,r),h.userData.mimeType=r.mimeType||Mf(r.uri),h}).catch(function(h){throw console.error("THREE.GLTFLoader: Couldn't load texture",a),h});return this.sourceCache[e]=u,u}assignTexture(e,t,n,i){let s=this;return this.getDependency("texture",n.index).then(function(r){if(!r)return null;if(n.texCoord!==void 0&&n.texCoord>0&&(r=r.clone(),r.channel=n.texCoord),s.extensions[q.KHR_TEXTURE_TRANSFORM]){let o=n.extensions!==void 0?n.extensions[q.KHR_TEXTURE_TRANSFORM]:void 0;if(o){let a=s.associations.get(r);r=s.extensions[q.KHR_TEXTURE_TRANSFORM].extendTexture(r,o),s.associations.set(r,a)}}return i!==void 0&&(r.colorSpace=i),e[t]=r,r})}assignFinalMaterial(e){let t=e.geometry,n=e.material,i=t.attributes.tangent===void 0,s=t.attributes.color!==void 0,r=t.attributes.normal===void 0;if(e.isPoints){let o="PointsMaterial:"+n.uuid,a=this.cache.get(o);a||(a=new st,Te.prototype.copy.call(a,n),a.color.copy(n.color),a.map=n.map,a.sizeAttenuation=!1,this.cache.add(o,a)),n=a}else if(e.isLine){let o="LineBasicMaterial:"+n.uuid,a=this.cache.get(o);a||(a=new Xe,Te.prototype.copy.call(a,n),a.color.copy(n.color),a.map=n.map,this.cache.add(o,a)),n=a}if(i||s||r){let o="ClonedMaterial:"+n.uuid+":";i&&(o+="derivative-tangents:"),s&&(o+="vertex-colors:"),r&&(o+="flat-shading:");let a=this.cache.get(o);a||(a=n.clone(),s&&(a.vertexColors=!0),r&&(a.flatShading=!0),i&&(a.normalScale&&(a.normalScale.y*=-1),a.clearcoatNormalScale&&(a.clearcoatNormalScale.y*=-1)),this.cache.add(o,a),this.associations.set(a,this.associations.get(n))),n=a}e.material=n}getMaterialType(){return lt}loadMaterial(e){let t=this,n=this.json,i=this.extensions,s=n.materials[e],r,o={},a=s.extensions||{},c=[];if(a[q.KHR_MATERIALS_UNLIT]){let h=i[q.KHR_MATERIALS_UNLIT];r=h.getMaterialType(),c.push(h.extendParams(o,s,t))}else{let h=s.pbrMetallicRoughness||{};if(o.color=new L(1,1,1),o.opacity=1,Array.isArray(h.baseColorFactor)){let f=h.baseColorFactor;o.color.setRGB(f[0],f[1],f[2],ze),o.opacity=f[3]}h.baseColorTexture!==void 0&&c.push(t.assignTexture(o,"map",h.baseColorTexture,O)),o.metalness=h.metallicFactor!==void 0?h.metallicFactor:1,o.roughness=h.roughnessFactor!==void 0?h.roughnessFactor:1,h.metallicRoughnessTexture!==void 0&&(c.push(t.assignTexture(o,"metalnessMap",h.metallicRoughnessTexture)),c.push(t.assignTexture(o,"roughnessMap",h.metallicRoughnessTexture))),r=this._invokeOne(function(f){return f.getMaterialType&&f.getMaterialType(e)}),c.push(Promise.all(this._invokeAll(function(f){return f.extendMaterialParams&&f.extendMaterialParams(e,o)})))}s.doubleSided===!0&&(o.side=di);let u=s.alphaMode||Vr.OPAQUE;if(u===Vr.BLEND?(o.transparent=!0,o.depthWrite=!1):(o.transparent=!1,u===Vr.MASK&&(o.alphaTest=s.alphaCutoff!==void 0?s.alphaCutoff:.5)),s.normalTexture!==void 0&&r!==ct&&(c.push(t.assignTexture(o,"normalMap",s.normalTexture)),o.normalScale=new Z(1,1),s.normalTexture.scale!==void 0)){let h=s.normalTexture.scale;o.normalScale.set(h,h)}if(s.occlusionTexture!==void 0&&r!==ct&&(c.push(t.assignTexture(o,"aoMap",s.occlusionTexture)),s.occlusionTexture.strength!==void 0&&(o.aoMapIntensity=s.occlusionTexture.strength)),s.emissiveFactor!==void 0&&r!==ct){let h=s.emissiveFactor;o.emissive=new L().setRGB(h[0],h[1],h[2],ze)}return s.emissiveTexture!==void 0&&r!==ct&&c.push(t.assignTexture(o,"emissiveMap",s.emissiveTexture,O)),Promise.all(c).then(function(){let h=new r(o);return s.name&&(h.name=s.name),ut(h,s),t.associations.set(h,{materials:e}),s.extensions&&ln(i,h,s),h})}createUniqueName(e){let t=X.sanitizeNodeName(e||"");return t in this.nodeNamesUsed?t+"_"+ ++this.nodeNamesUsed[t]:(this.nodeNamesUsed[t]=0,t)}loadGeometries(e){let t=this,n=this.extensions,i=this.primitiveCache;function s(o){return n[q.KHR_DRACO_MESH_COMPRESSION].decodePrimitive(o,t).then(function(a){return ja(a,o,t)})}let r=[];for(let o=0,a=e.length;o<a;o++){let c=e[o],u=vf(c),h=i[u];if(h)r.push(h.promise);else{let f;c.extensions&&c.extensions[q.KHR_DRACO_MESH_COMPRESSION]?f=s(c):f=ja(new me,c,t),i[u]={primitive:c,promise:f},r.push(f)}}return Promise.all(r)}loadMesh(e){let t=this,n=this.json,i=this.extensions,s=n.meshes[e],r=s.primitives,o=[];for(let a=0,c=r.length;a<c;a++){let u=r[a].material===void 0?xf(this.cache):this.getDependency("material",r[a].material);o.push(u)}return o.push(t.loadGeometries(r)),Promise.all(o).then(function(a){let c=a.slice(0,a.length-1),u=a[a.length-1],h=[];for(let d=0,p=u.length;d<p;d++){let g=u[d],m=r[d],x,v=c[d];if(m.mode===Ze.TRIANGLES||m.mode===Ze.TRIANGLE_STRIP||m.mode===Ze.TRIANGLE_FAN||m.mode===void 0)x=s.isSkinnedMesh===!0?new Qt(g,v):new we(g,v),x.isSkinnedMesh===!0&&x.normalizeSkinWeights(),m.mode===Ze.TRIANGLE_STRIP?x.geometry=zr(x.geometry,_i):m.mode===Ze.TRIANGLE_FAN&&(x.geometry=zr(x.geometry,Fn));else if(m.mode===Ze.LINES)x=new Ht(g,v);else if(m.mode===Ze.LINE_STRIP)x=new bt(g,v);else if(m.mode===Ze.LINE_LOOP)x=new ti(g,v);else if(m.mode===Ze.POINTS)x=new wt(g,v);else throw new Error("THREE.GLTFLoader: Primitive mode unsupported: "+m.mode);Object.keys(x.geometry.morphAttributes).length>0&&yf(x,s),x.name=t.createUniqueName(s.name||"mesh_"+e),ut(x,s),m.extensions&&ln(i,x,m),t.assignFinalMaterial(x),h.push(x)}for(let d=0,p=h.length;d<p;d++)t.associations.set(h[d],{meshes:e,primitives:d});if(h.length===1)return s.extensions&&ln(i,h[0],s),h[0];let f=new Le;s.extensions&&ln(i,f,s),t.associations.set(f,{meshes:e});for(let d=0,p=h.length;d<p;d++)f.add(h[d]);return f})}loadCamera(e){let t,n=this.json.cameras[e],i=n[n.type];if(!i){console.warn("THREE.GLTFLoader: Missing camera parameters.");return}return n.type==="perspective"?t=new St(pe.radToDeg(i.yfov),i.aspectRatio||1,i.znear||1,i.zfar||2e6):n.type==="orthographic"&&(t=new Nn(-i.xmag,i.xmag,i.ymag,-i.ymag,i.znear,i.zfar)),n.name&&(t.name=this.createUniqueName(n.name)),ut(t,n),Promise.resolve(t)}loadSkin(e){let t=this.json.skins[e],n=[];for(let i=0,s=t.joints.length;i<s;i++)n.push(this._loadNodeShallow(t.joints[i]));return t.inverseBindMatrices!==void 0?n.push(this.getDependency("accessor",t.inverseBindMatrices)):n.push(null),Promise.all(n).then(function(i){let s=i.pop(),r=i,o=[],a=[];for(let c=0,u=r.length;c<u;c++){let h=r[c];if(h){o.push(h);let f=new D;s!==null&&f.fromArray(s.array,c*16),a.push(f)}else console.warn('THREE.GLTFLoader: Joint "%s" could not be found.',t.joints[c])}return new en(o,a)})}loadAnimation(e){let t=this.json,n=this,i=t.animations[e],s=i.name?i.name:"animation_"+e,r=[],o=[],a=[],c=[],u=[];for(let h=0,f=i.channels.length;h<f;h++){let d=i.channels[h],p=i.samplers[d.sampler],g=d.target,m=g.node,x=i.parameters!==void 0?i.parameters[p.input]:p.input,v=i.parameters!==void 0?i.parameters[p.output]:p.output;g.node!==void 0&&(r.push(this.getDependency("node",m)),o.push(this.getDependency("accessor",x)),a.push(this.getDependency("accessor",v)),c.push(p),u.push(g))}return Promise.all([Promise.all(r),Promise.all(o),Promise.all(a),Promise.all(c),Promise.all(u)]).then(function(h){let f=h[0],d=h[1],p=h[2],g=h[3],m=h[4],x=[];for(let y=0,_=f.length;y<_;y++){let S=f[y],T=d[y],b=p[y],w=g[y],E=m[y];if(S===void 0)continue;S.updateMatrix&&S.updateMatrix();let C=n._createAnimationTracks(S,T,b,w,E);if(C)for(let A=0;A<C.length;A++)x.push(C[A])}let v=new sn(s,void 0,x);return ut(v,i),v})}createNodeMesh(e){let t=this.json,n=this,i=t.nodes[e];return i.mesh===void 0?null:n.getDependency("mesh",i.mesh).then(function(s){let r=n._getNodeRef(n.meshCache,i.mesh,s);return i.weights!==void 0&&r.traverse(function(o){if(o.isMesh)for(let a=0,c=i.weights.length;a<c;a++)o.morphTargetInfluences[a]=i.weights[a]}),r})}loadNode(e){let t=this.json,n=this,i=t.nodes[e],s=n._loadNodeShallow(e),r=[],o=i.children||[];for(let c=0,u=o.length;c<u;c++)r.push(n.getDependency("node",o[c]));let a=i.skin===void 0?Promise.resolve(null):n.getDependency("skin",i.skin);return Promise.all([s,Promise.all(r),a]).then(function(c){let u=c[0],h=c[1],f=c[2];f!==null&&u.traverse(function(d){d.isSkinnedMesh&&d.bind(f,Sf)});for(let d=0,p=h.length;d<p;d++)u.add(h[d]);return u})}_loadNodeShallow(e){let t=this.json,n=this.extensions,i=this;if(this.nodeCache[e]!==void 0)return this.nodeCache[e];let s=t.nodes[e],r=s.name?i.createUniqueName(s.name):"",o=[],a=i._invokeOne(function(c){return c.createNodeMesh&&c.createNodeMesh(e)});return a&&o.push(a),s.camera!==void 0&&o.push(i.getDependency("camera",s.camera).then(function(c){return i._getNodeRef(i.cameraCache,s.camera,c)})),i._invokeAll(function(c){return c.createNodeAttachment&&c.createNodeAttachment(e)}).forEach(function(c){o.push(c)}),this.nodeCache[e]=Promise.all(o).then(function(c){let u;if(s.isBone===!0?u=new Tt:c.length>1?u=new Le:c.length===1?u=c[0]:u=new oe,u!==c[0])for(let h=0,f=c.length;h<f;h++)u.add(c[h]);if(s.name&&(u.userData.name=s.name,u.name=r),ut(u,s),s.extensions&&ln(n,u,s),s.matrix!==void 0){let h=new D;h.fromArray(s.matrix),u.applyMatrix4(h)}else s.translation!==void 0&&u.position.fromArray(s.translation),s.rotation!==void 0&&u.quaternion.fromArray(s.rotation),s.scale!==void 0&&u.scale.fromArray(s.scale);if(!i.associations.has(u))i.associations.set(u,{});else if(s.mesh!==void 0&&i.meshCache.refs[s.mesh]>1){let h=i.associations.get(u);i.associations.set(u,{...h})}return i.associations.get(u).nodes=e,u}),this.nodeCache[e]}loadScene(e){let t=this.extensions,n=this.json.scenes[e],i=this,s=new Le;n.name&&(s.name=i.createUniqueName(n.name)),ut(s,n),n.extensions&&ln(t,s,n);let r=n.nodes||[],o=[];for(let a=0,c=r.length;a<c;a++)o.push(i.getDependency("node",r[a]));return Promise.all(o).then(function(a){for(let u=0,h=a.length;u<h;u++)s.add(a[u]);let c=u=>{let h=new Map;for(let[f,d]of i.associations)(f instanceof Te||f instanceof Ie)&&h.set(f,d);return u.traverse(f=>{let d=i.associations.get(f);d!=null&&h.set(f,d)}),h};return i.associations=c(s),s})}_createAnimationTracks(e,t,n,i,s){let r=[],o=e.name?e.name:e.uuid,a=[];Wt[s.path]===Wt.weights?e.traverse(function(f){f.morphTargetInfluences&&a.push(f.name?f.name:f.uuid)}):a.push(o);let c;switch(Wt[s.path]){case Wt.weights:c=Ye;break;case Wt.rotation:c=Ve;break;case Wt.translation:case Wt.scale:c=Ke;break;default:switch(n.itemSize){case 1:c=Ye;break;case 2:case 3:default:c=Ke;break}break}let u=i.interpolation!==void 0?gf[i.interpolation]:Mt,h=this._getArrayFromAccessor(n);for(let f=0,d=a.length;f<d;f++){let p=new c(a[f]+"."+Wt[s.path],t.array,h,u);i.interpolation==="CUBICSPLINE"&&this._createCubicSplineTrackInterpolant(p),r.push(p)}return r}_getArrayFromAccessor(e){let t=e.array;if(e.normalized){let n=po(t.constructor),i=new Float32Array(t.length);for(let s=0,r=t.length;s<r;s++)i[s]=t[s]*n;t=i}return t}_createCubicSplineTrackInterpolant(e){e.createInterpolant=function(n){let i=this instanceof Ve?uo:xs;return new i(this.times,this.values,this.getValueSize()/3,n)},e.createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline=!0}};function Tf(l,e,t){let n=e.attributes,i=new ke;if(n.POSITION!==void 0){let o=t.json.accessors[n.POSITION],a=o.min,c=o.max;if(a!==void 0&&c!==void 0){if(i.set(new M(a[0],a[1],a[2]),new M(c[0],c[1],c[2])),o.normalized){let u=po(Bn[o.componentType]);i.min.multiplyScalar(u),i.max.multiplyScalar(u)}}else{console.warn("THREE.GLTFLoader: Missing min/max properties for accessor POSITION.");return}}else return;let s=e.targets;if(s!==void 0){let o=new M,a=new M;for(let c=0,u=s.length;c<u;c++){let h=s[c];if(h.POSITION!==void 0){let f=t.json.accessors[h.POSITION],d=f.min,p=f.max;if(d!==void 0&&p!==void 0){if(a.setX(Math.max(Math.abs(d[0]),Math.abs(p[0]))),a.setY(Math.max(Math.abs(d[1]),Math.abs(p[1]))),a.setZ(Math.max(Math.abs(d[2]),Math.abs(p[2]))),f.normalized){let g=po(Bn[f.componentType]);a.multiplyScalar(g)}o.max(a)}else console.warn("THREE.GLTFLoader: Missing min/max properties for accessor POSITION.")}}i.expandByVector(o)}l.boundingBox=i;let r=new Pe;i.getCenter(r.center),r.radius=i.min.distanceTo(i.max)/2,l.boundingSphere=r}function ja(l,e,t){let n=e.attributes,i=[];function s(r,o){return t.getDependency("accessor",r).then(function(a){l.setAttribute(o,a)})}for(let r in n){let o=fo[r]||r.toLowerCase();o in l.attributes||i.push(s(n[r],o))}if(e.indices!==void 0&&!l.index){let r=t.getDependency("accessor",e.indices).then(function(o){l.setIndex(o)});i.push(r)}return re.workingColorSpace!==ze&&"COLOR_0"in n&&console.warn(`THREE.GLTFLoader: Converting vertex colors from "srgb-linear" to "${re.workingColorSpace}" not supported.`),ut(l,e),Tf(l,e,t),Promise.all(i).then(function(){return e.targets!==void 0?_f(l,e.targets,t):l})}var Qa={POSITION:["byte","byte normalized","unsigned byte","unsigned byte normalized","short","short normalized","unsigned short","unsigned short normalized"],NORMAL:["byte normalized","short normalized"],TANGENT:["byte normalized","short normalized"],TEXCOORD:["byte","byte normalized","unsigned byte","short","short normalized","unsigned short"]},hn=class{constructor(){this.textureUtils=null,this.pluginCallbacks=[],this.register(function(e){return new yo(e)}),this.register(function(e){return new vo(e)}),this.register(function(e){return new bo(e)}),this.register(function(e){return new wo(e)}),this.register(function(e){return new Ao(e)}),this.register(function(e){return new Eo(e)}),this.register(function(e){return new Mo(e)}),this.register(function(e){return new So(e)}),this.register(function(e){return new To(e)}),this.register(function(e){return new Ro(e)}),this.register(function(e){return new Co(e)}),this.register(function(e){return new Io(e)}),this.register(function(e){return new Po(e)}),this.register(function(e){return new Lo(e)})}register(e){return this.pluginCallbacks.indexOf(e)===-1&&this.pluginCallbacks.push(e),this}unregister(e){return this.pluginCallbacks.indexOf(e)!==-1&&this.pluginCallbacks.splice(this.pluginCallbacks.indexOf(e),1),this}setTextureUtils(e){return this.textureUtils=e,this}parse(e,t,n,i){let s=new _o,r=[];for(let o=0,a=this.pluginCallbacks.length;o<a;o++)r.push(this.pluginCallbacks[o](s));s.setPlugins(r),s.setTextureUtils(this.textureUtils),s.writeAsync(e,t,i).catch(n)}parseAsync(e,t){let n=this;return new Promise(function(i,s){n.parse(e,i,s,t)})}},Y={POINTS:0,LINES:1,LINE_LOOP:2,LINE_STRIP:3,TRIANGLES:4,TRIANGLE_STRIP:5,TRIANGLE_FAN:6,BYTE:5120,UNSIGNED_BYTE:5121,SHORT:5122,UNSIGNED_SHORT:5123,INT:5124,UNSIGNED_INT:5125,FLOAT:5126,ARRAY_BUFFER:34962,ELEMENT_ARRAY_BUFFER:34963,NEAREST:9728,LINEAR:9729,NEAREST_MIPMAP_NEAREST:9984,LINEAR_MIPMAP_NEAREST:9985,NEAREST_MIPMAP_LINEAR:9986,LINEAR_MIPMAP_LINEAR:9987,CLAMP_TO_EDGE:33071,MIRRORED_REPEAT:33648,REPEAT:10497},go="KHR_mesh_quantization",Ge={};Ge[kt]=Y.NEAREST;Ge[pi]=Y.NEAREST_MIPMAP_NEAREST;Ge[mi]=Y.NEAREST_MIPMAP_LINEAR;Ge[nt]=Y.LINEAR;Ge[gi]=Y.LINEAR_MIPMAP_NEAREST;Ge[ht]=Y.LINEAR_MIPMAP_LINEAR;Ge[Re]=Y.CLAMP_TO_EDGE;Ge[Ce]=Y.REPEAT;Ge[Jt]=Y.MIRRORED_REPEAT;var ec={scale:"scale",position:"translation",quaternion:"rotation",morphTargetInfluences:"weights"},bf=new L,tc=12,wf=1179937895,Af=2,nc=8,Ef=1313821514,Rf=5130562;function Mi(l,e){return l.length===e.length&&l.every(function(t,n){return t===e[n]})}function Cf(l){return new TextEncoder().encode(l).buffer}function If(l){return Mi(l.elements,[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1])}function Pf(l,e,t){let n={min:new Array(l.itemSize).fill(Number.POSITIVE_INFINITY),max:new Array(l.itemSize).fill(Number.NEGATIVE_INFINITY)};for(let i=e;i<e+t;i++)for(let s=0;s<l.itemSize;s++){let r;l.itemSize>4?r=l.array[i*l.itemSize+s]:(s===0?r=l.getX(i):s===1?r=l.getY(i):s===2?r=l.getZ(i):s===3&&(r=l.getW(i)),l.normalized===!0&&(r=pe.normalize(r,l.array))),n.min[s]=Math.min(n.min[s],r),n.max[s]=Math.max(n.max[s],r)}return n}function sc(l){return Math.ceil(l/4)*4}function xo(l,e=0){let t=sc(l.byteLength);if(t!==l.byteLength){let n=new Uint8Array(t);if(n.set(new Uint8Array(l)),e!==0)for(let i=l.byteLength;i<t;i++)n[i]=e;return n.buffer}return l}function ic(){return typeof document>"u"&&typeof OffscreenCanvas<"u"?new OffscreenCanvas(1,1):document.createElement("canvas")}function Lf(l,e){if(typeof OffscreenCanvas<"u"&&l instanceof OffscreenCanvas){let t;return e==="image/jpeg"?t=.92:e==="image/webp"&&(t=.8),l.convertToBlob({type:e,quality:t})}else return new Promise(t=>l.toBlob(t,e))}var _o=class{constructor(){this.plugins=[],this.options={},this.pending=[],this.buffers=[],this.byteOffset=0,this.buffers=[],this.nodeMap=new Map,this.skins=[],this.extensionsUsed={},this.extensionsRequired={},this.uids=new Map,this.uid=0,this.json={asset:{version:"2.0",generator:"THREE.GLTFExporter r180"}},this.cache={meshes:new Map,attributes:new Map,attributesNormalized:new Map,materials:new Map,textures:new Map,images:new Map},this.textureUtils=null}setPlugins(e){this.plugins=e}setTextureUtils(e){this.textureUtils=e}async writeAsync(e,t,n={}){this.options=Object.assign({binary:!1,trs:!1,onlyVisible:!0,maxTextureSize:1/0,animations:[],includeCustomExtensions:!1},n),this.options.animations.length>0&&(this.options.trs=!0),await this.processInputAsync(e),await Promise.all(this.pending);let i=this,s=i.buffers,r=i.json;n=i.options;let o=i.extensionsUsed,a=i.extensionsRequired,c=new Blob(s,{type:"application/octet-stream"}),u=Object.keys(o),h=Object.keys(a);if(u.length>0&&(r.extensionsUsed=u),h.length>0&&(r.extensionsRequired=h),r.buffers&&r.buffers.length>0&&(r.buffers[0].byteLength=c.size),n.binary===!0){let f=new FileReader;f.readAsArrayBuffer(c),f.onloadend=function(){let d=xo(f.result),p=new DataView(new ArrayBuffer(nc));p.setUint32(0,d.byteLength,!0),p.setUint32(4,Rf,!0);let g=xo(Cf(JSON.stringify(r)),32),m=new DataView(new ArrayBuffer(nc));m.setUint32(0,g.byteLength,!0),m.setUint32(4,Ef,!0);let x=new ArrayBuffer(tc),v=new DataView(x);v.setUint32(0,wf,!0),v.setUint32(4,Af,!0);let y=tc+m.byteLength+g.byteLength+p.byteLength+d.byteLength;v.setUint32(8,y,!0);let _=new Blob([x,m,g,p,d],{type:"application/octet-stream"}),S=new FileReader;S.readAsArrayBuffer(_),S.onloadend=function(){t(S.result)}}}else if(r.buffers&&r.buffers.length>0){let f=new FileReader;f.readAsDataURL(c),f.onloadend=function(){let d=f.result;r.buffers[0].uri=d,t(r)}}else t(r)}serializeUserData(e,t){if(Object.keys(e.userData).length===0)return;let n=this.options,i=this.extensionsUsed;try{let s=JSON.parse(JSON.stringify(e.userData));if(n.includeCustomExtensions&&s.gltfExtensions){t.extensions===void 0&&(t.extensions={});for(let r in s.gltfExtensions)t.extensions[r]=s.gltfExtensions[r],i[r]=!0;delete s.gltfExtensions}Object.keys(s).length>0&&(t.extras=s)}catch(s){console.warn("THREE.GLTFExporter: userData of '"+e.name+"' won't be serialized because of JSON.stringify error - "+s.message)}}getUID(e,t=!1){if(this.uids.has(e)===!1){let i=new Map;i.set(!0,this.uid++),i.set(!1,this.uid++),this.uids.set(e,i)}return this.uids.get(e).get(t)}isNormalizedNormalAttribute(e){if(this.cache.attributesNormalized.has(e))return!1;let n=new M;for(let i=0,s=e.count;i<s;i++)if(Math.abs(n.fromBufferAttribute(e,i).length()-1)>5e-4)return!1;return!0}createNormalizedNormalAttribute(e){let t=this.cache;if(t.attributesNormalized.has(e))return t.attributesNormalized.get(e);let n=e.clone(),i=new M;for(let s=0,r=n.count;s<r;s++)i.fromBufferAttribute(n,s),i.x===0&&i.y===0&&i.z===0?i.setX(1):i.normalize(),n.setXYZ(s,i.x,i.y,i.z);return t.attributesNormalized.set(e,n),n}applyTextureTransform(e,t){let n=!1,i={};(t.offset.x!==0||t.offset.y!==0)&&(i.offset=t.offset.toArray(),n=!0),t.rotation!==0&&(i.rotation=t.rotation,n=!0),(t.repeat.x!==1||t.repeat.y!==1)&&(i.scale=t.repeat.toArray(),n=!0),n&&(e.extensions=e.extensions||{},e.extensions.KHR_texture_transform=i,this.extensionsUsed.KHR_texture_transform=!0)}async buildMetalRoughTextureAsync(e,t){if(e===t)return e;function n(d){return d.colorSpace===O?function(g){return g<.04045?g*.0773993808:Math.pow(g*.9478672986+.0521327014,2.4)}:function(g){return g}}e instanceof tn&&(e=await this.decompressTextureAsync(e)),t instanceof tn&&(t=await this.decompressTextureAsync(t));let i=e?e.image:null,s=t?t.image:null,r=Math.max(i?i.width:0,s?s.width:0),o=Math.max(i?i.height:0,s?s.height:0),a=ic();a.width=r,a.height=o;let c=a.getContext("2d",{willReadFrequently:!0});c.fillStyle="#00ffff",c.fillRect(0,0,r,o);let u=c.getImageData(0,0,r,o);if(i){c.drawImage(i,0,0,r,o);let d=n(e),p=c.getImageData(0,0,r,o).data;for(let g=2;g<p.length;g+=4)u.data[g]=d(p[g]/256)*256}if(s){c.drawImage(s,0,0,r,o);let d=n(t),p=c.getImageData(0,0,r,o).data;for(let g=1;g<p.length;g+=4)u.data[g]=d(p[g]/256)*256}c.putImageData(u,0,0);let f=(e||t).clone();return f.source=new En(a),f.colorSpace=yi,f.channel=(e||t).channel,e&&t&&e.channel!==t.channel&&console.warn("THREE.GLTFExporter: UV channels for metalnessMap and roughnessMap textures must match."),console.warn("THREE.GLTFExporter: Merged metalnessMap and roughnessMap textures."),f}async decompressTextureAsync(e,t=1/0){if(this.textureUtils===null)throw new Error("THREE.GLTFExporter: setTextureUtils() must be called to process compressed textures.");return await this.textureUtils.decompress(e,t)}processBuffer(e){let t=this.json,n=this.buffers;return t.buffers||(t.buffers=[{byteLength:0}]),n.push(e),0}processBufferView(e,t,n,i,s){let r=this.json;r.bufferViews||(r.bufferViews=[]);let o;switch(t){case Y.BYTE:case Y.UNSIGNED_BYTE:o=1;break;case Y.SHORT:case Y.UNSIGNED_SHORT:o=2;break;default:o=4}let a=e.itemSize*o;s===Y.ARRAY_BUFFER&&(a=Math.ceil(a/4)*4);let c=sc(i*a),u=new DataView(new ArrayBuffer(c)),h=0;for(let p=n;p<n+i;p++){for(let g=0;g<e.itemSize;g++){let m;e.itemSize>4?m=e.array[p*e.itemSize+g]:(g===0?m=e.getX(p):g===1?m=e.getY(p):g===2?m=e.getZ(p):g===3&&(m=e.getW(p)),e.normalized===!0&&(m=pe.normalize(m,e.array))),t===Y.FLOAT?u.setFloat32(h,m,!0):t===Y.INT?u.setInt32(h,m,!0):t===Y.UNSIGNED_INT?u.setUint32(h,m,!0):t===Y.SHORT?u.setInt16(h,m,!0):t===Y.UNSIGNED_SHORT?u.setUint16(h,m,!0):t===Y.BYTE?u.setInt8(h,m):t===Y.UNSIGNED_BYTE&&u.setUint8(h,m),h+=o}h%a!==0&&(h+=a-h%a)}let f={buffer:this.processBuffer(u.buffer),byteOffset:this.byteOffset,byteLength:c};return s!==void 0&&(f.target=s),s===Y.ARRAY_BUFFER&&(f.byteStride=a),this.byteOffset+=c,r.bufferViews.push(f),{id:r.bufferViews.length-1,byteLength:0}}processBufferViewImage(e){let t=this,n=t.json;return n.bufferViews||(n.bufferViews=[]),new Promise(function(i){let s=new FileReader;s.readAsArrayBuffer(e),s.onloadend=function(){let r=xo(s.result),o={buffer:t.processBuffer(r),byteOffset:t.byteOffset,byteLength:r.byteLength};t.byteOffset+=r.byteLength,i(n.bufferViews.push(o)-1)}})}processAccessor(e,t,n,i){let s=this.json,r={1:"SCALAR",2:"VEC2",3:"VEC3",4:"VEC4",9:"MAT3",16:"MAT4"},o;if(e.array.constructor===Float32Array)o=Y.FLOAT;else if(e.array.constructor===Int32Array)o=Y.INT;else if(e.array.constructor===Uint32Array)o=Y.UNSIGNED_INT;else if(e.array.constructor===Int16Array)o=Y.SHORT;else if(e.array.constructor===Uint16Array)o=Y.UNSIGNED_SHORT;else if(e.array.constructor===Int8Array)o=Y.BYTE;else if(e.array.constructor===Uint8Array)o=Y.UNSIGNED_BYTE;else throw new Error("THREE.GLTFExporter: Unsupported bufferAttribute component type: "+e.array.constructor.name);if(n===void 0&&(n=0),(i===void 0||i===1/0)&&(i=e.count),i===0)return null;let a=Pf(e,n,i),c;t!==void 0&&(c=e===t.index?Y.ELEMENT_ARRAY_BUFFER:Y.ARRAY_BUFFER);let u=this.processBufferView(e,o,n,i,c),h={bufferView:u.id,byteOffset:u.byteOffset,componentType:o,count:i,max:a.max,min:a.min,type:r[e.itemSize]};return e.normalized===!0&&(h.normalized=!0),s.accessors||(s.accessors=[]),s.accessors.push(h)-1}processImage(e,t,n,i="image/png"){if(e!==null){let s=this,r=s.cache,o=s.json,a=s.options,c=s.pending;r.images.has(e)||r.images.set(e,{});let u=r.images.get(e),h=i+":flipY/"+n.toString();if(u[h]!==void 0)return u[h];o.images||(o.images=[]);let f={mimeType:i},d=ic();d.width=Math.min(e.width,a.maxTextureSize),d.height=Math.min(e.height,a.maxTextureSize);let p=d.getContext("2d",{willReadFrequently:!0});if(n===!0&&(p.translate(0,d.height),p.scale(1,-1)),e.data!==void 0){t!==xi&&console.error("GLTFExporter: Only RGBAFormat is supported.",t),(e.width>a.maxTextureSize||e.height>a.maxTextureSize)&&console.warn("GLTFExporter: Image size is bigger than maxTextureSize",e);let m=new Uint8ClampedArray(e.height*e.width*4);for(let x=0;x<m.length;x+=4)m[x+0]=e.data[x+0],m[x+1]=e.data[x+1],m[x+2]=e.data[x+2],m[x+3]=e.data[x+3];p.putImageData(new ImageData(m,e.width,e.height),0,0)}else if(typeof HTMLImageElement<"u"&&e instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&e instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&e instanceof ImageBitmap||typeof OffscreenCanvas<"u"&&e instanceof OffscreenCanvas)p.drawImage(e,0,0,d.width,d.height);else throw new Error("THREE.GLTFExporter: Invalid image type. Use HTMLImageElement, HTMLCanvasElement, ImageBitmap or OffscreenCanvas.");a.binary===!0?c.push(Lf(d,i).then(m=>s.processBufferViewImage(m)).then(m=>{f.bufferView=m})):f.uri=An.getDataURL(d,i);let g=o.images.push(f)-1;return u[h]=g,g}else throw new Error("THREE.GLTFExporter: No valid image data found. Unable to process texture.")}processSampler(e){let t=this.json;t.samplers||(t.samplers=[]);let n={magFilter:Ge[e.magFilter],minFilter:Ge[e.minFilter],wrapS:Ge[e.wrapS],wrapT:Ge[e.wrapT]};return t.samplers.push(n)-1}async processTextureAsync(e){let n=this.options,i=this.cache,s=this.json;if(i.textures.has(e))return i.textures.get(e);s.textures||(s.textures=[]),e instanceof tn&&(e=await this.decompressTextureAsync(e,n.maxTextureSize));let r=e.userData.mimeType;r==="image/webp"&&(r="image/png");let o={sampler:this.processSampler(e),source:this.processImage(e.image,e.format,e.flipY,r)};e.name&&(o.name=e.name),await this._invokeAllAsync(async function(c){c.writeTexture&&await c.writeTexture(e,o)});let a=s.textures.push(o)-1;return i.textures.set(e,a),a}async processMaterialAsync(e){let t=this.cache,n=this.json;if(t.materials.has(e))return t.materials.get(e);if(e.isShaderMaterial)return console.warn("GLTFExporter: THREE.ShaderMaterial not supported."),null;n.materials||(n.materials=[]);let i={pbrMetallicRoughness:{}};e.isMeshStandardMaterial!==!0&&e.isMeshBasicMaterial!==!0&&console.warn("GLTFExporter: Use MeshStandardMaterial or MeshBasicMaterial for best results.");let s=e.color.toArray().concat([e.opacity]);if(Mi(s,[1,1,1,1])||(i.pbrMetallicRoughness.baseColorFactor=s),e.isMeshStandardMaterial?(i.pbrMetallicRoughness.metallicFactor=e.metalness,i.pbrMetallicRoughness.roughnessFactor=e.roughness):(i.pbrMetallicRoughness.metallicFactor=0,i.pbrMetallicRoughness.roughnessFactor=1),e.metalnessMap||e.roughnessMap){let o=await this.buildMetalRoughTextureAsync(e.metalnessMap,e.roughnessMap),a={index:await this.processTextureAsync(o),texCoord:o.channel};this.applyTextureTransform(a,o),i.pbrMetallicRoughness.metallicRoughnessTexture=a}if(e.map){let o={index:await this.processTextureAsync(e.map),texCoord:e.map.channel};this.applyTextureTransform(o,e.map),i.pbrMetallicRoughness.baseColorTexture=o}if(e.emissive){let o=e.emissive;if(Math.max(o.r,o.g,o.b)>0&&(i.emissiveFactor=e.emissive.toArray()),e.emissiveMap){let c={index:await this.processTextureAsync(e.emissiveMap),texCoord:e.emissiveMap.channel};this.applyTextureTransform(c,e.emissiveMap),i.emissiveTexture=c}}if(e.normalMap){let o={index:await this.processTextureAsync(e.normalMap),texCoord:e.normalMap.channel};e.normalScale&&e.normalScale.x!==1&&(o.scale=e.normalScale.x),this.applyTextureTransform(o,e.normalMap),i.normalTexture=o}if(e.aoMap){let o={index:await this.processTextureAsync(e.aoMap),texCoord:e.aoMap.channel};e.aoMapIntensity!==1&&(o.strength=e.aoMapIntensity),this.applyTextureTransform(o,e.aoMap),i.occlusionTexture=o}e.transparent?i.alphaMode="BLEND":e.alphaTest>0&&(i.alphaMode="MASK",i.alphaCutoff=e.alphaTest),e.side===di&&(i.doubleSided=!0),e.name!==""&&(i.name=e.name),this.serializeUserData(e,i),await this._invokeAllAsync(async function(o){o.writeMaterialAsync&&await o.writeMaterialAsync(e,i)});let r=n.materials.push(i)-1;return t.materials.set(e,r),r}async processMeshAsync(e){let t=this.cache,n=this.json,i=[e.geometry.uuid];if(Array.isArray(e.material))for(let _=0,S=e.material.length;_<S;_++)i.push(e.material[_].uuid);else i.push(e.material.uuid);let s=i.join(":");if(t.meshes.has(s))return t.meshes.get(s);let r=e.geometry,o;e.isLineSegments?o=Y.LINES:e.isLineLoop?o=Y.LINE_LOOP:e.isLine?o=Y.LINE_STRIP:e.isPoints?o=Y.POINTS:o=e.material.wireframe?Y.LINES:Y.TRIANGLES;let a={},c={},u=[],h=[],f={uv:"TEXCOORD_0",uv1:"TEXCOORD_1",uv2:"TEXCOORD_2",uv3:"TEXCOORD_3",color:"COLOR_0",skinWeight:"WEIGHTS_0",skinIndex:"JOINTS_0"},d=r.getAttribute("normal");d!==void 0&&!this.isNormalizedNormalAttribute(d)&&(console.warn("THREE.GLTFExporter: Creating normalized normal attribute from the non-normalized one."),r.setAttribute("normal",this.createNormalizedNormalAttribute(d)));let p=null;for(let _ in r.attributes){if(_.slice(0,5)==="morph")continue;let S=r.attributes[_];if(_=f[_]||_.toUpperCase(),/^(POSITION|NORMAL|TANGENT|TEXCOORD_\d+|COLOR_\d+|JOINTS_\d+|WEIGHTS_\d+)$/.test(_)||(_="_"+_),t.attributes.has(this.getUID(S))){c[_]=t.attributes.get(this.getUID(S));continue}p=null;let b=S.array;_==="JOINTS_0"&&!(b instanceof Uint16Array)&&!(b instanceof Uint8Array)?(console.warn('GLTFExporter: Attribute "skinIndex" converted to type UNSIGNED_SHORT.'),p=new se(new Uint16Array(b),S.itemSize,S.normalized)):(b instanceof Uint32Array||b instanceof Int32Array)&&!_.startsWith("_")&&(console.warn(`GLTFExporter: Attribute "${_}" converted to type FLOAT.`),p=hn.Utils.toFloat32BufferAttribute(S));let w=this.processAccessor(p||S,r);w!==null&&(_.startsWith("_")||this.detectMeshQuantization(_,S),c[_]=w,t.attributes.set(this.getUID(S),w))}if(d!==void 0&&r.setAttribute("normal",d),Object.keys(c).length===0)return null;if(e.morphTargetInfluences!==void 0&&e.morphTargetInfluences.length>0){let _=[],S=[],T={};if(e.morphTargetDictionary!==void 0)for(let b in e.morphTargetDictionary)T[e.morphTargetDictionary[b]]=b;for(let b=0;b<e.morphTargetInfluences.length;++b){let w={},E=!1;for(let C in r.morphAttributes){if(C!=="position"&&C!=="normal"){E||(console.warn("GLTFExporter: Only POSITION and NORMAL morph are supported."),E=!0);continue}let A=r.morphAttributes[C][b],K=C.toUpperCase(),$=r.attributes[C];if(t.attributes.has(this.getUID(A,!0))){w[K]=t.attributes.get(this.getUID(A,!0));continue}let le=A.clone();if(!r.morphTargetsRelative)for(let te=0,R=A.count;te<R;te++)for(let V=0;V<A.itemSize;V++)V===0&&le.setX(te,A.getX(te)-$.getX(te)),V===1&&le.setY(te,A.getY(te)-$.getY(te)),V===2&&le.setZ(te,A.getZ(te)-$.getZ(te)),V===3&&le.setW(te,A.getW(te)-$.getW(te));w[K]=this.processAccessor(le,r),t.attributes.set(this.getUID($,!0),w[K])}h.push(w),_.push(e.morphTargetInfluences[b]),e.morphTargetDictionary!==void 0&&S.push(T[b])}a.weights=_,S.length>0&&(a.extras={},a.extras.targetNames=S)}let g=Array.isArray(e.material);if(g&&r.groups.length===0)return null;let m=!1;if(g&&r.index===null){let _=[];for(let S=0,T=r.attributes.position.count;S<T;S++)_[S]=S;r.setIndex(_),m=!0}let x=g?e.material:[e.material],v=g?r.groups:[{materialIndex:0,start:void 0,count:void 0}];for(let _=0,S=v.length;_<S;_++){let T={mode:o,attributes:c};if(this.serializeUserData(r,T),h.length>0&&(T.targets=h),r.index!==null){let w=this.getUID(r.index);(v[_].start!==void 0||v[_].count!==void 0)&&(w+=":"+v[_].start+":"+v[_].count),t.attributes.has(w)?T.indices=t.attributes.get(w):(T.indices=this.processAccessor(r.index,r,v[_].start,v[_].count),t.attributes.set(w,T.indices)),T.indices===null&&delete T.indices}let b=await this.processMaterialAsync(x[v[_].materialIndex]);b!==null&&(T.material=b),u.push(T)}m===!0&&r.setIndex(null),a.primitives=u,n.meshes||(n.meshes=[]),await this._invokeAllAsync(function(_){_.writeMesh&&_.writeMesh(e,a)});let y=n.meshes.push(a)-1;return t.meshes.set(s,y),y}detectMeshQuantization(e,t){if(this.extensionsUsed[go])return;let n;switch(t.array.constructor){case Int8Array:n="byte";break;case Uint8Array:n="unsigned byte";break;case Int16Array:n="short";break;case Uint16Array:n="unsigned short";break;default:return}t.normalized&&(n+=" normalized");let i=e.split("_",1)[0];Qa[i]&&Qa[i].includes(n)&&(this.extensionsUsed[go]=!0,this.extensionsRequired[go]=!0)}processCamera(e){let t=this.json;t.cameras||(t.cameras=[]);let n=e.isOrthographicCamera,i={type:n?"orthographic":"perspective"};return n?i.orthographic={xmag:e.right*2,ymag:e.top*2,zfar:e.far<=0?.001:e.far,znear:e.near<0?0:e.near}:i.perspective={aspectRatio:e.aspect,yfov:pe.degToRad(e.fov),zfar:e.far<=0?.001:e.far,znear:e.near<0?0:e.near},e.name!==""&&(i.name=e.type),t.cameras.push(i)-1}processAnimation(e,t){let n=this.json,i=this.nodeMap;n.animations||(n.animations=[]),e=hn.Utils.mergeMorphTargetTracks(e.clone(),t);let s=e.tracks,r=[],o=[];for(let c=0;c<s.length;++c){let u=s[c],h=X.parseTrackName(u.name),f=X.findNode(t,h.nodeName),d=ec[h.propertyName];if(h.objectName==="bones"&&(f.isSkinnedMesh===!0?f=f.skeleton.getBoneByName(h.objectIndex):f=void 0),!f||!d){console.warn('THREE.GLTFExporter: Could not export animation track "%s".',u.name);continue}let p=1,g=u.values.length/u.times.length;d===ec.morphTargetInfluences&&(g/=f.morphTargetInfluences.length);let m;u.createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline===!0?(m="CUBICSPLINE",g/=3):u.getInterpolation()===vt?m="STEP":m="LINEAR",o.push({input:this.processAccessor(new se(u.times,p)),output:this.processAccessor(new se(u.values,g)),interpolation:m}),r.push({sampler:o.length-1,target:{node:i.get(f),path:d}})}let a={name:e.name||"clip_"+n.animations.length,samplers:o,channels:r};return this.serializeUserData(e,a),n.animations.push(a),n.animations.length-1}processSkin(e){let t=this.json,n=this.nodeMap,i=t.nodes[n.get(e)],s=e.skeleton;if(s===void 0)return null;let r=e.skeleton.bones[0];if(r===void 0)return null;let o=[],a=new Float32Array(s.bones.length*16),c=new D;for(let h=0;h<s.bones.length;++h)o.push(n.get(s.bones[h])),c.copy(s.boneInverses[h]),c.multiply(e.bindMatrix).toArray(a,h*16);return t.skins===void 0&&(t.skins=[]),t.skins.push({inverseBindMatrices:this.processAccessor(new se(a,16)),joints:o,skeleton:n.get(r)}),i.skin=t.skins.length-1}async processNodeAsync(e){let t=this.json,n=this.options,i=this.nodeMap;t.nodes||(t.nodes=[]);let s={};if(n.trs){let o=e.quaternion.toArray(),a=e.position.toArray(),c=e.scale.toArray();Mi(o,[0,0,0,1])||(s.rotation=o),Mi(a,[0,0,0])||(s.translation=a),Mi(c,[1,1,1])||(s.scale=c)}else e.matrixAutoUpdate&&e.updateMatrix(),If(e.matrix)===!1&&(s.matrix=e.matrix.elements);if(e.name!==""&&(s.name=String(e.name)),this.serializeUserData(e,s),e.isMesh||e.isLine||e.isPoints){let o=await this.processMeshAsync(e);o!==null&&(s.mesh=o)}else e.isCamera&&(s.camera=this.processCamera(e));e.isSkinnedMesh&&this.skins.push(e);let r=t.nodes.push(s)-1;if(i.set(e,r),e.children.length>0){let o=[];for(let a=0,c=e.children.length;a<c;a++){let u=e.children[a];if(u.visible||n.onlyVisible===!1){let h=await this.processNodeAsync(u);h!==null&&o.push(h)}}o.length>0&&(s.children=o)}return await this._invokeAllAsync(function(o){o.writeNode&&o.writeNode(e,s)}),r}async processSceneAsync(e){let t=this.json,n=this.options;t.scenes||(t.scenes=[],t.scene=0);let i={};e.name!==""&&(i.name=e.name),t.scenes.push(i);let s=[];for(let r=0,o=e.children.length;r<o;r++){let a=e.children[r];if(a.visible||n.onlyVisible===!1){let c=await this.processNodeAsync(a);c!==null&&s.push(c)}}s.length>0&&(i.nodes=s),this.serializeUserData(e,i)}async processObjectsAsync(e){let t=new Cn;t.name="AuxScene";for(let n=0;n<e.length;n++)t.children.push(e[n]);await this.processSceneAsync(t)}async processInputAsync(e){let t=this.options;e=e instanceof Array?e:[e],await this._invokeAllAsync(function(i){i.beforeParse&&i.beforeParse(e)});let n=[];for(let i=0;i<e.length;i++)e[i]instanceof Cn?await this.processSceneAsync(e[i]):n.push(e[i]);n.length>0&&await this.processObjectsAsync(n);for(let i=0;i<this.skins.length;++i)this.processSkin(this.skins[i]);for(let i=0;i<t.animations.length;++i)this.processAnimation(t.animations[i],e[0]);await this._invokeAllAsync(function(i){i.afterParse&&i.afterParse(e)})}async _invokeAllAsync(e){for(let t=0,n=this.plugins.length;t<n;t++)await e(this.plugins[t])}},yo=class{constructor(e){this.writer=e,this.name="KHR_lights_punctual"}writeNode(e,t){if(!e.isLight)return;if(!e.isDirectionalLight&&!e.isPointLight&&!e.isSpotLight){console.warn("THREE.GLTFExporter: Only directional, point, and spot lights are supported.",e);return}let n=this.writer,i=n.json,s=n.extensionsUsed,r={};e.name&&(r.name=e.name),r.color=e.color.toArray(),r.intensity=e.intensity,e.isDirectionalLight?r.type="directional":e.isPointLight?(r.type="point",e.distance>0&&(r.range=e.distance)):e.isSpotLight&&(r.type="spot",e.distance>0&&(r.range=e.distance),r.spot={},r.spot.innerConeAngle=(1-e.penumbra)*e.angle,r.spot.outerConeAngle=e.angle),e.decay!==void 0&&e.decay!==2&&console.warn("THREE.GLTFExporter: Light decay may be lost. glTF is physically-based, and expects light.decay=2."),e.target&&(e.target.parent!==e||e.target.position.x!==0||e.target.position.y!==0||e.target.position.z!==-1)&&console.warn("THREE.GLTFExporter: Light direction may be lost. For best results, make light.target a child of the light with position 0,0,-1."),s[this.name]||(i.extensions=i.extensions||{},i.extensions[this.name]={lights:[]},s[this.name]=!0);let o=i.extensions[this.name].lights;o.push(r),t.extensions=t.extensions||{},t.extensions[this.name]={light:o.length-1}}},vo=class{constructor(e){this.writer=e,this.name="KHR_materials_unlit"}async writeMaterialAsync(e,t){if(!e.isMeshBasicMaterial)return;let i=this.writer.extensionsUsed;t.extensions=t.extensions||{},t.extensions[this.name]={},i[this.name]=!0,t.pbrMetallicRoughness.metallicFactor=0,t.pbrMetallicRoughness.roughnessFactor=.9}},Mo=class{constructor(e){this.writer=e,this.name="KHR_materials_clearcoat"}async writeMaterialAsync(e,t){if(!e.isMeshPhysicalMaterial||e.clearcoat===0)return;let n=this.writer,i=n.extensionsUsed,s={};if(s.clearcoatFactor=e.clearcoat,e.clearcoatMap){let r={index:await n.processTextureAsync(e.clearcoatMap),texCoord:e.clearcoatMap.channel};n.applyTextureTransform(r,e.clearcoatMap),s.clearcoatTexture=r}if(s.clearcoatRoughnessFactor=e.clearcoatRoughness,e.clearcoatRoughnessMap){let r={index:await n.processTextureAsync(e.clearcoatRoughnessMap),texCoord:e.clearcoatRoughnessMap.channel};n.applyTextureTransform(r,e.clearcoatRoughnessMap),s.clearcoatRoughnessTexture=r}if(e.clearcoatNormalMap){let r={index:await n.processTextureAsync(e.clearcoatNormalMap),texCoord:e.clearcoatNormalMap.channel};e.clearcoatNormalScale.x!==1&&(r.scale=e.clearcoatNormalScale.x),n.applyTextureTransform(r,e.clearcoatNormalMap),s.clearcoatNormalTexture=r}t.extensions=t.extensions||{},t.extensions[this.name]=s,i[this.name]=!0}},So=class{constructor(e){this.writer=e,this.name="KHR_materials_dispersion"}async writeMaterialAsync(e,t){if(!e.isMeshPhysicalMaterial||e.dispersion===0)return;let i=this.writer.extensionsUsed,s={};s.dispersion=e.dispersion,t.extensions=t.extensions||{},t.extensions[this.name]=s,i[this.name]=!0}},To=class{constructor(e){this.writer=e,this.name="KHR_materials_iridescence"}async writeMaterialAsync(e,t){if(!e.isMeshPhysicalMaterial||e.iridescence===0)return;let n=this.writer,i=n.extensionsUsed,s={};if(s.iridescenceFactor=e.iridescence,e.iridescenceMap){let r={index:await n.processTextureAsync(e.iridescenceMap),texCoord:e.iridescenceMap.channel};n.applyTextureTransform(r,e.iridescenceMap),s.iridescenceTexture=r}if(s.iridescenceIor=e.iridescenceIOR,s.iridescenceThicknessMinimum=e.iridescenceThicknessRange[0],s.iridescenceThicknessMaximum=e.iridescenceThicknessRange[1],e.iridescenceThicknessMap){let r={index:await n.processTextureAsync(e.iridescenceThicknessMap),texCoord:e.iridescenceThicknessMap.channel};n.applyTextureTransform(r,e.iridescenceThicknessMap),s.iridescenceThicknessTexture=r}t.extensions=t.extensions||{},t.extensions[this.name]=s,i[this.name]=!0}},bo=class{constructor(e){this.writer=e,this.name="KHR_materials_transmission"}async writeMaterialAsync(e,t){if(!e.isMeshPhysicalMaterial||e.transmission===0)return;let n=this.writer,i=n.extensionsUsed,s={};if(s.transmissionFactor=e.transmission,e.transmissionMap){let r={index:await n.processTextureAsync(e.transmissionMap),texCoord:e.transmissionMap.channel};n.applyTextureTransform(r,e.transmissionMap),s.transmissionTexture=r}t.extensions=t.extensions||{},t.extensions[this.name]=s,i[this.name]=!0}},wo=class{constructor(e){this.writer=e,this.name="KHR_materials_volume"}async writeMaterialAsync(e,t){if(!e.isMeshPhysicalMaterial||e.transmission===0)return;let n=this.writer,i=n.extensionsUsed,s={};if(s.thicknessFactor=e.thickness,e.thicknessMap){let r={index:await n.processTextureAsync(e.thicknessMap),texCoord:e.thicknessMap.channel};n.applyTextureTransform(r,e.thicknessMap),s.thicknessTexture=r}e.attenuationDistance!==1/0&&(s.attenuationDistance=e.attenuationDistance),s.attenuationColor=e.attenuationColor.toArray(),t.extensions=t.extensions||{},t.extensions[this.name]=s,i[this.name]=!0}},Ao=class{constructor(e){this.writer=e,this.name="KHR_materials_ior"}async writeMaterialAsync(e,t){if(!e.isMeshPhysicalMaterial||e.ior===1.5)return;let i=this.writer.extensionsUsed,s={};s.ior=e.ior,t.extensions=t.extensions||{},t.extensions[this.name]=s,i[this.name]=!0}},Eo=class{constructor(e){this.writer=e,this.name="KHR_materials_specular"}async writeMaterialAsync(e,t){if(!e.isMeshPhysicalMaterial||e.specularIntensity===1&&e.specularColor.equals(bf)&&!e.specularIntensityMap&&!e.specularColorMap)return;let n=this.writer,i=n.extensionsUsed,s={};if(e.specularIntensityMap){let r={index:await n.processTextureAsync(e.specularIntensityMap),texCoord:e.specularIntensityMap.channel};n.applyTextureTransform(r,e.specularIntensityMap),s.specularTexture=r}if(e.specularColorMap){let r={index:await n.processTextureAsync(e.specularColorMap),texCoord:e.specularColorMap.channel};n.applyTextureTransform(r,e.specularColorMap),s.specularColorTexture=r}s.specularFactor=e.specularIntensity,s.specularColorFactor=e.specularColor.toArray(),t.extensions=t.extensions||{},t.extensions[this.name]=s,i[this.name]=!0}},Ro=class{constructor(e){this.writer=e,this.name="KHR_materials_sheen"}async writeMaterialAsync(e,t){if(!e.isMeshPhysicalMaterial||e.sheen==0)return;let n=this.writer,i=n.extensionsUsed,s={};if(e.sheenRoughnessMap){let r={index:await n.processTextureAsync(e.sheenRoughnessMap),texCoord:e.sheenRoughnessMap.channel};n.applyTextureTransform(r,e.sheenRoughnessMap),s.sheenRoughnessTexture=r}if(e.sheenColorMap){let r={index:await n.processTextureAsync(e.sheenColorMap),texCoord:e.sheenColorMap.channel};n.applyTextureTransform(r,e.sheenColorMap),s.sheenColorTexture=r}s.sheenRoughnessFactor=e.sheenRoughness,s.sheenColorFactor=e.sheenColor.toArray(),t.extensions=t.extensions||{},t.extensions[this.name]=s,i[this.name]=!0}},Co=class{constructor(e){this.writer=e,this.name="KHR_materials_anisotropy"}async writeMaterialAsync(e,t){if(!e.isMeshPhysicalMaterial||e.anisotropy==0)return;let n=this.writer,i=n.extensionsUsed,s={};if(e.anisotropyMap){let r={index:await n.processTextureAsync(e.anisotropyMap)};n.applyTextureTransform(r,e.anisotropyMap),s.anisotropyTexture=r}s.anisotropyStrength=e.anisotropy,s.anisotropyRotation=e.anisotropyRotation,t.extensions=t.extensions||{},t.extensions[this.name]=s,i[this.name]=!0}},Io=class{constructor(e){this.writer=e,this.name="KHR_materials_emissive_strength"}async writeMaterialAsync(e,t){if(!e.isMeshStandardMaterial||e.emissiveIntensity===1)return;let i=this.writer.extensionsUsed,s={};s.emissiveStrength=e.emissiveIntensity,t.extensions=t.extensions||{},t.extensions[this.name]=s,i[this.name]=!0}},Po=class{constructor(e){this.writer=e,this.name="EXT_materials_bump"}async writeMaterialAsync(e,t){if(!e.isMeshStandardMaterial||e.bumpScale===1&&!e.bumpMap)return;let n=this.writer,i=n.extensionsUsed,s={};if(e.bumpMap){let r={index:await n.processTextureAsync(e.bumpMap),texCoord:e.bumpMap.channel};n.applyTextureTransform(r,e.bumpMap),s.bumpTexture=r}s.bumpFactor=e.bumpScale,t.extensions=t.extensions||{},t.extensions[this.name]=s,i[this.name]=!0}},Lo=class{constructor(e){this.writer=e,this.name="EXT_mesh_gpu_instancing"}writeNode(e,t){if(!e.isInstancedMesh)return;let n=this.writer,i=e,s=new Float32Array(i.count*3),r=new Float32Array(i.count*4),o=new Float32Array(i.count*3),a=new D,c=new M,u=new fe,h=new M;for(let d=0;d<i.count;d++)i.getMatrixAt(d,a),a.decompose(c,u,h),c.toArray(s,d*3),u.toArray(r,d*4),h.toArray(o,d*3);let f={TRANSLATION:n.processAccessor(new se(s,3)),ROTATION:n.processAccessor(new se(r,4)),SCALE:n.processAccessor(new se(o,3))};i.instanceColor&&(f._COLOR_0=n.processAccessor(i.instanceColor)),t.extensions=t.extensions||{},t.extensions[this.name]={attributes:f},n.extensionsUsed[this.name]=!0,n.extensionsRequired[this.name]=!0}};hn.Utils={insertKeyframe:function(l,e){let n=l.getValueSize(),i=new l.TimeBufferType(l.times.length+1),s=new l.ValueBufferType(l.values.length+n),r=l.createInterpolant(new l.ValueBufferType(n)),o;if(l.times.length===0){i[0]=e;for(let a=0;a<n;a++)s[a]=0;o=0}else if(e<l.times[0]){if(Math.abs(l.times[0]-e)<.001)return 0;i[0]=e,i.set(l.times,1),s.set(r.evaluate(e),0),s.set(l.values,n),o=0}else if(e>l.times[l.times.length-1]){if(Math.abs(l.times[l.times.length-1]-e)<.001)return l.times.length-1;i[i.length-1]=e,i.set(l.times,0),s.set(l.values,0),s.set(r.evaluate(e),l.values.length),o=i.length-1}else for(let a=0;a<l.times.length;a++){if(Math.abs(l.times[a]-e)<.001)return a;if(l.times[a]<e&&l.times[a+1]>e){i.set(l.times.slice(0,a+1),0),i[a+1]=e,i.set(l.times.slice(a+1),a+2),s.set(l.values.slice(0,(a+1)*n),0),s.set(r.evaluate(e),(a+1)*n),s.set(l.values.slice((a+1)*n),(a+2)*n),o=a+1;break}}return l.times=i,l.values=s,o},mergeMorphTargetTracks:function(l,e){let t=[],n={},i=l.tracks;for(let s=0;s<i.length;++s){let r=i[s],o=X.parseTrackName(r.name),a=X.findNode(e,o.nodeName);if(o.propertyName!=="morphTargetInfluences"||o.propertyIndex===void 0){t.push(r);continue}if(r.createInterpolant!==r.InterpolantFactoryMethodDiscrete&&r.createInterpolant!==r.InterpolantFactoryMethodLinear){if(r.createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline)throw new Error("THREE.GLTFExporter: Cannot merge tracks with glTF CUBICSPLINE interpolation.");console.warn("THREE.GLTFExporter: Morph target interpolation mode not yet supported. Using LINEAR instead."),r=r.clone(),r.setInterpolation(Mt)}let c=a.morphTargetInfluences.length,u=a.morphTargetDictionary[o.propertyIndex];if(u===void 0)throw new Error("THREE.GLTFExporter: Morph target name not found: "+o.propertyIndex);let h;if(n[a.uuid]===void 0){h=r.clone();let d=new h.ValueBufferType(c*h.times.length);for(let p=0;p<h.times.length;p++)d[p*c+u]=h.values[p];h.name=(o.nodeName||"")+".morphTargetInfluences",h.values=d,n[a.uuid]=h,t.push(h);continue}let f=r.createInterpolant(new r.ValueBufferType(1));h=n[a.uuid];for(let d=0;d<h.times.length;d++)h.values[d*c+u]=f.evaluate(h.times[d]);for(let d=0;d<r.times.length;d++){let p=this.insertKeyframe(h,r.times[d]);h.values[p*c+u]=r.values[d]}}return l.tracks=t,l},toFloat32BufferAttribute:function(l){let e=new se(new Float32Array(l.count*l.itemSize),l.itemSize,!1);if(!l.normalized&&!l.isInterleavedBufferAttribute)return e.array.set(l.array),e;for(let t=0,n=l.count;t<n;t++)for(let i=0;i<l.itemSize;i++)e.setComponent(t,i,l.getComponent(t,i));return e}};/*!
fflate - fast JavaScript compression/decompression
<https://101arrowz.github.io/fflate>
Licensed under MIT. https://github.com/101arrowz/fflate/blob/master/LICENSE
version 0.8.2
*/var Je=Uint8Array,zn=Uint16Array,Df=Int32Array,rc=new Je([0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0,0,0,0]),oc=new Je([0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13,0,0]),Uf=new Je([16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15]),ac=function(l,e){for(var t=new zn(31),n=0;n<31;++n)t[n]=e+=1<<l[n-1];for(var i=new Df(t[30]),n=1;n<30;++n)for(var s=t[n];s<t[n+1];++s)i[s]=s-t[n]<<5|n;return{b:t,r:i}},cc=ac(rc,2),lc=cc.b,Nf=cc.r;lc[28]=258,Nf[258]=28;var hc=ac(oc,0),Ff=hc.b,Bx=hc.r,No=new zn(32768);for(ee=0;ee<32768;++ee)It=(ee&43690)>>1|(ee&21845)<<1,It=(It&52428)>>2|(It&13107)<<2,It=(It&61680)>>4|(It&3855)<<4,No[ee]=((It&65280)>>8|(It&255)<<8)>>1;var It,ee,Si=(function(l,e,t){for(var n=l.length,i=0,s=new zn(e);i<n;++i)l[i]&&++s[l[i]-1];var r=new zn(e);for(i=1;i<e;++i)r[i]=r[i-1]+s[i-1]<<1;var o;if(t){o=new zn(1<<e);var a=15-e;for(i=0;i<n;++i)if(l[i])for(var c=i<<4|l[i],u=e-l[i],h=r[l[i]-1]++<<u,f=h|(1<<u)-1;h<=f;++h)o[No[h]>>a]=c}else for(o=new zn(n),i=0;i<n;++i)l[i]&&(o[i]=No[r[l[i]-1]++]>>15-l[i]);return o}),Ti=new Je(288);for(ee=0;ee<144;++ee)Ti[ee]=8;var ee;for(ee=144;ee<256;++ee)Ti[ee]=9;var ee;for(ee=256;ee<280;++ee)Ti[ee]=7;var ee;for(ee=280;ee<288;++ee)Ti[ee]=8;var ee,uc=new Je(32);for(ee=0;ee<32;++ee)uc[ee]=5;var ee;var Of=Si(Ti,9,1);var Bf=Si(uc,5,1),Do=function(l){for(var e=l[0],t=1;t<l.length;++t)l[t]>e&&(e=l[t]);return e},rt=function(l,e,t){var n=e/8|0;return(l[n]|l[n+1]<<8)>>(e&7)&t},Uo=function(l,e){var t=e/8|0;return(l[t]|l[t+1]<<8|l[t+2]<<16)>>(e&7)},zf=function(l){return(l+7)/8|0},kf=function(l,e,t){return(e==null||e<0)&&(e=0),(t==null||t>l.length)&&(t=l.length),new Je(l.subarray(e,t))};var Vf=["unexpected EOF","invalid block type","invalid length/literal","invalid distance","stream finished","no stream handler",,"no callback","invalid UTF-8 data","extra field too long","date not in range 1980-2099","filename too long","stream finishing","invalid zip data"],ot=function(l,e,t){var n=new Error(e||Vf[l]);if(n.code=l,Error.captureStackTrace&&Error.captureStackTrace(n,ot),!t)throw n;return n},Hf=function(l,e,t,n){var i=l.length,s=n?n.length:0;if(!i||e.f&&!e.l)return t||new Je(0);var r=!t,o=r||e.i!=2,a=e.i;r&&(t=new Je(i*3));var c=function(qo){var Yo=t.length;if(qo>Yo){var Ko=new Je(Math.max(Yo*2,qo));Ko.set(t),t=Ko}},u=e.f||0,h=e.p||0,f=e.b||0,d=e.l,p=e.d,g=e.m,m=e.n,x=i*8;do{if(!d){u=rt(l,h,1);var v=rt(l,h+1,3);if(h+=3,v)if(v==1)d=Of,p=Bf,g=9,m=5;else if(v==2){var T=rt(l,h,31)+257,b=rt(l,h+10,15)+4,w=T+rt(l,h+5,31)+1;h+=14;for(var E=new Je(w),C=new Je(19),A=0;A<b;++A)C[Uf[A]]=rt(l,h+A*3,7);h+=b*3;for(var K=Do(C),$=(1<<K)-1,le=Si(C,K,1),A=0;A<w;){var te=le[rt(l,h,$)];h+=te&15;var y=te>>4;if(y<16)E[A++]=y;else{var R=0,V=0;for(y==16?(V=3+rt(l,h,3),h+=2,R=E[A-1]):y==17?(V=3+rt(l,h,7),h+=3):y==18&&(V=11+rt(l,h,127),h+=7);V--;)E[A++]=R}}var z=E.subarray(0,T),H=E.subarray(T);g=Do(z),m=Do(H),d=Si(z,g,1),p=Si(H,m,1)}else ot(1);else{var y=zf(h)+4,_=l[y-4]|l[y-3]<<8,S=y+_;if(S>i){a&&ot(0);break}o&&c(f+_),t.set(l.subarray(y,S),f),e.b=f+=_,e.p=h=S*8,e.f=u;continue}if(h>x){a&&ot(0);break}}o&&c(f+131072);for(var ae=(1<<g)-1,j=(1<<m)-1,ne=h;;ne=h){var R=d[Uo(l,h)&ae],B=R>>4;if(h+=R&15,h>x){a&&ot(0);break}if(R||ot(2),B<256)t[f++]=B;else if(B==256){ne=h,d=null;break}else{var F=B-254;if(B>264){var A=B-257,U=rc[A];F=rt(l,h,(1<<U)-1)+lc[A],h+=U}var P=p[Uo(l,h)&j],N=P>>4;P||ot(3),h+=P&15;var H=Ff[N];if(N>3){var U=oc[N];H+=Uo(l,h)&(1<<U)-1,h+=U}if(h>x){a&&ot(0);break}o&&c(f+131072);var ce=f+F;if(f<H){var Fe=s-H,un=Math.min(H,ce);for(Fe+f<0&&ot(3);f<un;++f)t[f]=n[Fe+f]}for(;f<ce;++f)t[f]=t[f-H]}}e.l=d,e.p=ne,e.b=f,e.f=u,d&&(u=1,e.m=g,e.d=p,e.n=m)}while(!u);return f!=t.length&&r?kf(t,0,f):t.subarray(0,f)};var Gf=new Je(0);var Wf=function(l,e){return((l[0]&15)!=8||l[0]>>4>7||(l[0]<<8|l[1])%31)&&ot(6,"invalid zlib data"),(l[1]>>5&1)==+!e&&ot(6,"invalid zlib data: "+(l[1]&32?"need":"unexpected")+" dictionary"),(l[1]>>3&4)+2};function fc(l,e){return Hf(l.subarray(Wf(l,e&&e.dictionary),-4),{i:2},e&&e.out,e&&e.dictionary)}var Xf=typeof TextDecoder<"u"&&new TextDecoder,qf=0;try{Xf.decode(Gf,{stream:!0}),qf=1}catch{}function dc(l,e,t){let n=t.length-l-1;if(e>=t[n])return n-1;if(e<=t[l])return l;let i=l,s=n,r=Math.floor((i+s)/2);for(;e<t[r]||e>=t[r+1];)e<t[r]?s=r:i=r,r=Math.floor((i+s)/2);return r}function Kf(l,e,t,n){let i=[],s=[],r=[];i[0]=1;for(let o=1;o<=t;++o){s[o]=e-n[l+1-o],r[o]=n[l+o]-e;let a=0;for(let c=0;c<o;++c){let u=r[c+1],h=s[o-c],f=i[c]/(u+h);i[c]=a+u*f,a=h*f}i[o]=a}return i}function pc(l,e,t,n){let i=dc(l,n,e),s=Kf(i,n,l,e),r=new he(0,0,0,0);for(let o=0;o<=l;++o){let a=t[i-l+o],c=s[o],u=a.w*c;r.x+=a.x*u,r.y+=a.y*u,r.z+=a.z*u,r.w+=a.w*c}return r}function Zf(l,e,t,n,i){let s=[];for(let h=0;h<=t;++h)s[h]=0;let r=[];for(let h=0;h<=n;++h)r[h]=s.slice(0);let o=[];for(let h=0;h<=t;++h)o[h]=s.slice(0);o[0][0]=1;let a=s.slice(0),c=s.slice(0);for(let h=1;h<=t;++h){a[h]=e-i[l+1-h],c[h]=i[l+h]-e;let f=0;for(let d=0;d<h;++d){let p=c[d+1],g=a[h-d];o[h][d]=p+g;let m=o[d][h-1]/o[h][d];o[d][h]=f+p*m,f=g*m}o[h][h]=f}for(let h=0;h<=t;++h)r[0][h]=o[h][t];for(let h=0;h<=t;++h){let f=0,d=1,p=[];for(let g=0;g<=t;++g)p[g]=s.slice(0);p[0][0]=1;for(let g=1;g<=n;++g){let m=0,x=h-g,v=t-g;h>=g&&(p[d][0]=p[f][0]/o[v+1][x],m=p[d][0]*o[x][v]);let y=x>=-1?1:-x,_=h-1<=v?g-1:t-h;for(let T=y;T<=_;++T)p[d][T]=(p[f][T]-p[f][T-1])/o[v+1][x+T],m+=p[d][T]*o[x+T][v];h<=v&&(p[d][g]=-p[f][g-1]/o[v+1][h],m+=p[d][g]*o[h][v]),r[g][h]=m;let S=f;f=d,d=S}}let u=t;for(let h=1;h<=n;++h){for(let f=0;f<=t;++f)r[h][f]*=u;u*=t-h}return r}function Jf(l,e,t,n,i){let s=i<l?i:l,r=[],o=dc(l,n,e),a=Zf(o,n,l,s,e),c=[];for(let u=0;u<t.length;++u){let h=t[u].clone(),f=h.w;h.x*=f,h.y*=f,h.z*=f,c[u]=h}for(let u=0;u<=s;++u){let h=c[o-l].clone().multiplyScalar(a[u][0]);for(let f=1;f<=l;++f)h.add(c[o-l+f].clone().multiplyScalar(a[u][f]));r[u]=h}for(let u=s+1;u<=i+1;++u)r[u]=new he(0,0,0);return r}function jf(l,e){let t=1;for(let i=2;i<=l;++i)t*=i;let n=1;for(let i=2;i<=e;++i)n*=i;for(let i=2;i<=l-e;++i)n*=i;return t/n}function $f(l){let e=l.length,t=[],n=[];for(let s=0;s<e;++s){let r=l[s];t[s]=new M(r.x,r.y,r.z),n[s]=r.w}let i=[];for(let s=0;s<e;++s){let r=t[s].clone();for(let o=1;o<=s;++o)r.sub(i[s-o].clone().multiplyScalar(jf(s,o)*n[o]));i[s]=r.divideScalar(n[0])}return i}function mc(l,e,t,n,i){let s=Jf(l,e,t,n,i);return $f(s)}var _s=class extends ni{constructor(e,t,n,i,s){super();let r=t?t.length-1:0,o=n?n.length:0;this.degree=e,this.knots=t,this.controlPoints=[],this.startKnot=i||0,this.endKnot=s||r;for(let a=0;a<o;++a){let c=n[a];this.controlPoints[a]=new he(c.x,c.y,c.z,c.w)}}getPoint(e,t=new M){let n=t,i=this.knots[this.startKnot]+e*(this.knots[this.endKnot]-this.knots[this.startKnot]),s=pc(this.degree,this.knots,this.controlPoints,i);return s.w!==1&&s.divideScalar(s.w),n.set(s.x,s.y,s.z)}getTangent(e,t=new M){let n=t,i=this.knots[0]+e*(this.knots[this.knots.length-1]-this.knots[0]),s=mc(this.degree,this.knots,this.controlPoints,i,1);return n.copy(s[1]).normalize(),n}toJSON(){let e=super.toJSON();return e.degree=this.degree,e.knots=[...this.knots],e.controlPoints=this.controlPoints.map(t=>t.toArray()),e.startKnot=this.startKnot,e.endKnot=this.endKnot,e}fromJSON(e){return super.fromJSON(e),this.degree=e.degree,this.knots=[...e.knots],this.controlPoints=e.controlPoints.map(t=>new he(t[0],t[1],t[2],t[3])),this.startKnot=e.startKnot,this.endKnot=e.endKnot,this}};var W,ge,Ee,vs=class extends de{constructor(e){super(e)}load(e,t,n,i){let s=this,r=s.path===""?He.extractUrlBase(e):s.path,o=new ve(this.manager);o.setPath(s.path),o.setResponseType("arraybuffer"),o.setRequestHeader(s.requestHeader),o.setWithCredentials(s.withCredentials),o.load(e,function(a){try{t(s.parse(a,r))}catch(c){i?i(c):console.error(c),s.manager.itemError(e)}},n,i)}parse(e,t){if(ed(e))W=new Ho().parse(e);else{let i=_c(e);if(!td(i))throw new Error("THREE.FBXLoader: Unknown format.");if(gc(i)<7e3)throw new Error("THREE.FBXLoader: FBX version not supported, FileVersion: "+gc(i));W=new Vo().parse(i)}let n=new Ct(this.manager).setPath(this.resourcePath||t).setCrossOrigin(this.crossOrigin);return new Bo(n,this.manager).parse(W)}},Bo=class{constructor(e,t){this.textureLoader=e,this.manager=t}parse(){ge=this.parseConnections();let e=this.parseImages(),t=this.parseTextures(e),n=this.parseMaterials(t),i=this.parseDeformers(),s=new zo().parse(i);return this.parseScene(i,s,n),Ee}parseConnections(){let e=new Map;return"Connections"in W&&W.Connections.connections.forEach(function(n){let i=n[0],s=n[1],r=n[2];e.has(i)||e.set(i,{parents:[],children:[]});let o={ID:s,relationship:r};e.get(i).parents.push(o),e.has(s)||e.set(s,{parents:[],children:[]});let a={ID:i,relationship:r};e.get(s).children.push(a)}),e}parseImages(){let e={},t={};if("Video"in W.Objects){let n=W.Objects.Video;for(let i in n){let s=n[i],r=parseInt(i);if(e[r]=s.RelativeFilename||s.Filename,"Content"in s){let o=s.Content instanceof ArrayBuffer&&s.Content.byteLength>0,a=typeof s.Content=="string"&&s.Content!=="";if(o||a){let c=this.parseImage(n[i]);t[s.RelativeFilename||s.Filename]=c}}}}for(let n in e){let i=e[n];t[i]!==void 0?e[n]=t[i]:e[n]=e[n].split("\\").pop()}return e}parseImage(e){let t=e.Content,n=e.RelativeFilename||e.Filename,i=n.slice(n.lastIndexOf(".")+1).toLowerCase(),s;switch(i){case"bmp":s="image/bmp";break;case"jpg":case"jpeg":s="image/jpeg";break;case"png":s="image/png";break;case"tif":s="image/tiff";break;case"tga":this.manager.getHandler(".tga")===null&&console.warn("FBXLoader: TGA loader not found, skipping ",n),s="image/tga";break;case"webp":s="image/webp";break;default:console.warn('FBXLoader: Image type "'+i+'" is not supported.');return}if(typeof t=="string")return"data:"+s+";base64,"+t;{let r=new Uint8Array(t);return window.URL.createObjectURL(new Blob([r],{type:s}))}}parseTextures(e){let t=new Map;if("Texture"in W.Objects){let n=W.Objects.Texture;for(let i in n){let s=this.parseTexture(n[i],e);t.set(parseInt(i),s)}}return t}parseTexture(e,t){let n=this.loadTexture(e,t);n.ID=e.id,n.name=e.attrName;let i=e.WrapModeU,s=e.WrapModeV,r=i!==void 0?i.value:0,o=s!==void 0?s.value:0;if(n.wrapS=r===0?Ce:Re,n.wrapT=o===0?Ce:Re,"Scaling"in e){let a=e.Scaling.value;n.repeat.x=a[0],n.repeat.y=a[1]}if("Translation"in e){let a=e.Translation.value;n.offset.x=a[0],n.offset.y=a[1]}return n}loadTexture(e,t){let n=e.FileName.split(".").pop().toLowerCase(),i=this.manager.getHandler(`.${n}`);i===null&&(i=this.textureLoader);let s=i.path;s||i.setPath(this.textureLoader.path);let r=ge.get(e.id).children,o;if(r!==void 0&&r.length>0&&t[r[0].ID]!==void 0&&(o=t[r[0].ID],(o.indexOf("blob:")===0||o.indexOf("data:")===0)&&i.setPath(void 0)),o===void 0)return console.warn("FBXLoader: Undefined filename, creating placeholder texture."),new Ie;let a=i.load(o);return i.setPath(s),a}parseMaterials(e){let t=new Map;if("Material"in W.Objects){let n=W.Objects.Material;for(let i in n){let s=this.parseMaterial(n[i],e);s!==null&&t.set(parseInt(i),s)}}return t}parseMaterial(e,t){let n=e.id,i=e.attrName,s=e.ShadingModel;if(typeof s=="object"&&(s=s.value),!ge.has(n))return null;let r=this.parseParameters(e,t,n),o;switch(s.toLowerCase()){case"phong":o=new qe;break;case"lambert":o=new ai;break;default:console.warn('THREE.FBXLoader: unknown material type "%s". Defaulting to MeshPhongMaterial.',s),o=new qe;break}return o.setValues(r),o.name=i,o}parseParameters(e,t,n){let i={};e.BumpFactor&&(i.bumpScale=e.BumpFactor.value),e.Diffuse?i.color=re.colorSpaceToWorking(new L().fromArray(e.Diffuse.value),O):e.DiffuseColor&&(e.DiffuseColor.type==="Color"||e.DiffuseColor.type==="ColorRGB")&&(i.color=re.colorSpaceToWorking(new L().fromArray(e.DiffuseColor.value),O)),e.DisplacementFactor&&(i.displacementScale=e.DisplacementFactor.value),e.Emissive?i.emissive=re.colorSpaceToWorking(new L().fromArray(e.Emissive.value),O):e.EmissiveColor&&(e.EmissiveColor.type==="Color"||e.EmissiveColor.type==="ColorRGB")&&(i.emissive=re.colorSpaceToWorking(new L().fromArray(e.EmissiveColor.value),O)),e.EmissiveFactor&&(i.emissiveIntensity=parseFloat(e.EmissiveFactor.value)),i.opacity=1-(e.TransparencyFactor?parseFloat(e.TransparencyFactor.value):0),(i.opacity===1||i.opacity===0)&&(i.opacity=e.Opacity?parseFloat(e.Opacity.value):null,i.opacity===null&&(i.opacity=1-(e.TransparentColor?parseFloat(e.TransparentColor.value[0]):0))),i.opacity<1&&(i.transparent=!0),e.ReflectionFactor&&(i.reflectivity=e.ReflectionFactor.value),e.Shininess&&(i.shininess=e.Shininess.value),e.Specular?i.specular=re.colorSpaceToWorking(new L().fromArray(e.Specular.value),O):e.SpecularColor&&e.SpecularColor.type==="Color"&&(i.specular=re.colorSpaceToWorking(new L().fromArray(e.SpecularColor.value),O));let s=this;return ge.get(n).children.forEach(function(r){let o=r.relationship;switch(o){case"Bump":i.bumpMap=s.getTexture(t,r.ID);break;case"Maya|TEX_ao_map":i.aoMap=s.getTexture(t,r.ID);break;case"DiffuseColor":case"Maya|TEX_color_map":i.map=s.getTexture(t,r.ID),i.map!==void 0&&(i.map.colorSpace=O);break;case"DisplacementColor":i.displacementMap=s.getTexture(t,r.ID);break;case"EmissiveColor":i.emissiveMap=s.getTexture(t,r.ID),i.emissiveMap!==void 0&&(i.emissiveMap.colorSpace=O);break;case"NormalMap":case"Maya|TEX_normal_map":i.normalMap=s.getTexture(t,r.ID);break;case"ReflectionColor":i.envMap=s.getTexture(t,r.ID),i.envMap!==void 0&&(i.envMap.mapping=Dr,i.envMap.colorSpace=O);break;case"SpecularColor":i.specularMap=s.getTexture(t,r.ID),i.specularMap!==void 0&&(i.specularMap.colorSpace=O);break;case"TransparentColor":case"TransparencyFactor":i.alphaMap=s.getTexture(t,r.ID),i.transparent=!0;break;case"AmbientColor":case"ShininessExponent":case"SpecularFactor":case"VectorDisplacementColor":default:console.warn("THREE.FBXLoader: %s map is not supported in three.js, skipping texture.",o);break}}),i}getTexture(e,t){return"LayeredTexture"in W.Objects&&t in W.Objects.LayeredTexture&&(console.warn("THREE.FBXLoader: layered textures are not supported in three.js. Discarding all but first layer."),t=ge.get(t).children[0].ID),e.get(t)}parseDeformers(){let e={},t={};if("Deformer"in W.Objects){let n=W.Objects.Deformer;for(let i in n){let s=n[i],r=ge.get(parseInt(i));if(s.attrType==="Skin"){let o=this.parseSkeleton(r,n);o.ID=i,r.parents.length>1&&console.warn("THREE.FBXLoader: skeleton attached to more than one geometry is not supported."),o.geometryID=r.parents[0].ID,e[i]=o}else if(s.attrType==="BlendShape"){let o={id:i};o.rawTargets=this.parseMorphTargets(r,n),o.id=i,r.parents.length>1&&console.warn("THREE.FBXLoader: morph target attached to more than one geometry is not supported."),t[i]=o}}}return{skeletons:e,morphTargets:t}}parseSkeleton(e,t){let n=[];return e.children.forEach(function(i){let s=t[i.ID];if(s.attrType!=="Cluster")return;let r={ID:i.ID,indices:[],weights:[],transformLink:new D().fromArray(s.TransformLink.a)};"Indexes"in s&&(r.indices=s.Indexes.a,r.weights=s.Weights.a),n.push(r)}),{rawBones:n,bones:[]}}parseMorphTargets(e,t){let n=[];for(let i=0;i<e.children.length;i++){let s=e.children[i],r=t[s.ID],o={name:r.attrName,initialWeight:r.DeformPercent,id:r.id,fullWeights:r.FullWeights.a};if(r.attrType!=="BlendShapeChannel")return;o.geoID=ge.get(parseInt(s.ID)).children.filter(function(a){return a.relationship===void 0})[0].ID,n.push(o)}return n}parseScene(e,t,n){Ee=new Le;let i=this.parseModels(e.skeletons,t,n),s=W.Objects.Model,r=this;i.forEach(function(a){let c=s[a.ID];r.setLookAtProperties(a,c),ge.get(a.ID).parents.forEach(function(h){let f=i.get(h.ID);f!==void 0&&f.add(a)}),a.parent===null&&Ee.add(a)}),this.bindSkeleton(e.skeletons,t,i),this.addGlobalSceneSettings(),Ee.traverse(function(a){if(a.userData.transformData){a.parent&&(a.userData.transformData.parentMatrix=a.parent.matrix,a.userData.transformData.parentMatrixWorld=a.parent.matrixWorld);let c=xc(a.userData.transformData);a.applyMatrix4(c),a.updateWorldMatrix()}});let o=new ko().parse();Ee.children.length===1&&Ee.children[0].isGroup&&(Ee.children[0].animations=o,Ee=Ee.children[0]),Ee.animations=o}parseModels(e,t,n){let i=new Map,s=W.Objects.Model;for(let r in s){let o=parseInt(r),a=s[r],c=ge.get(o),u=this.buildSkeleton(c,e,o,a.attrName);if(!u){switch(a.attrType){case"Camera":u=this.createCamera(c);break;case"Light":u=this.createLight(c);break;case"Mesh":u=this.createMesh(c,t,n);break;case"NurbsCurve":u=this.createCurve(c,t);break;case"LimbNode":case"Root":u=new Tt;break;case"Null":default:u=new Le;break}u.name=a.attrName?X.sanitizeNodeName(a.attrName):"",u.userData.originalName=a.attrName,u.ID=o}this.getTransformData(u,a),i.set(o,u)}return i}buildSkeleton(e,t,n,i){let s=null;return e.parents.forEach(function(r){for(let o in t){let a=t[o];a.rawBones.forEach(function(c,u){if(c.ID===r.ID){let h=s;s=new Tt,s.matrixWorld.copy(c.transformLink),s.name=i?X.sanitizeNodeName(i):"",s.userData.originalName=i,s.ID=n,a.bones[u]=s,h!==null&&s.add(h)}})}}),s}createCamera(e){let t,n;if(e.children.forEach(function(i){let s=W.Objects.NodeAttribute[i.ID];s!==void 0&&(n=s)}),n===void 0)t=new oe;else{let i=0;n.CameraProjectionType!==void 0&&n.CameraProjectionType.value===1&&(i=1);let s=1;n.NearPlane!==void 0&&(s=n.NearPlane.value/1e3);let r=1e3;n.FarPlane!==void 0&&(r=n.FarPlane.value/1e3);let o=window.innerWidth,a=window.innerHeight;n.AspectWidth!==void 0&&n.AspectHeight!==void 0&&(o=n.AspectWidth.value,a=n.AspectHeight.value);let c=o/a,u=45;n.FieldOfView!==void 0&&(u=n.FieldOfView.value);let h=n.FocalLength?n.FocalLength.value:null;switch(i){case 0:t=new St(u,c,s,r),h!==null&&t.setFocalLength(h);break;case 1:console.warn("THREE.FBXLoader: Orthographic cameras not supported yet."),t=new oe;break;default:console.warn("THREE.FBXLoader: Unknown camera type "+i+"."),t=new oe;break}}return t}createLight(e){let t,n;if(e.children.forEach(function(i){let s=W.Objects.NodeAttribute[i.ID];s!==void 0&&(n=s)}),n===void 0)t=new oe;else{let i;n.LightType===void 0?i=0:i=n.LightType.value;let s=16777215;n.Color!==void 0&&(s=re.colorSpaceToWorking(new L().fromArray(n.Color.value),O));let r=n.Intensity===void 0?1:n.Intensity.value/100;n.CastLightOnObject!==void 0&&n.CastLightOnObject.value===0&&(r=0);let o=0;n.FarAttenuationEnd!==void 0&&(n.EnableFarAttenuation!==void 0&&n.EnableFarAttenuation.value===0?o=0:o=n.FarAttenuationEnd.value);let a=1;switch(i){case 0:t=new Gt(s,r,o,a);break;case 1:t=new an(s,r);break;case 2:let c=Math.PI/3;n.InnerAngle!==void 0&&(c=pe.degToRad(n.InnerAngle.value));let u=0;n.OuterAngle!==void 0&&(u=pe.degToRad(n.OuterAngle.value),u=Math.max(u,1)),t=new on(s,r,o,c,u,a);break;default:console.warn("THREE.FBXLoader: Unknown light type "+n.LightType.value+", defaulting to a PointLight."),t=new Gt(s,r);break}n.CastShadows!==void 0&&n.CastShadows.value===1&&(t.castShadow=!0)}return t}createMesh(e,t,n){let i,s=null,r=null,o=[];if(e.children.forEach(function(a){t.has(a.ID)&&(s=t.get(a.ID)),n.has(a.ID)&&o.push(n.get(a.ID))}),o.length>1?r=o:o.length>0?r=o[0]:(r=new qe({name:de.DEFAULT_MATERIAL_NAME,color:13421772}),o.push(r)),"color"in s.attributes&&o.forEach(function(a){a.vertexColors=!0}),s.groups.length>0){let a=!1;for(let c=0,u=s.groups.length;c<u;c++){let h=s.groups[c];(h.materialIndex<0||h.materialIndex>=o.length)&&(h.materialIndex=o.length,a=!0)}if(a){let c=new qe;o.push(c)}}return s.FBX_Deformer?(i=new Qt(s,r),i.normalizeSkinWeights()):i=new we(s,r),i}createCurve(e,t){let n=e.children.reduce(function(s,r){return t.has(r.ID)&&(s=t.get(r.ID)),s},null),i=new Xe({name:de.DEFAULT_MATERIAL_NAME,color:3342591,linewidth:1});return new bt(n,i)}getTransformData(e,t){let n={};"InheritType"in t&&(n.inheritType=parseInt(t.InheritType.value)),"RotationOrder"in t?n.eulerOrder=bi(t.RotationOrder.value):n.eulerOrder=bi(0),"Lcl_Translation"in t&&(n.translation=t.Lcl_Translation.value),"PreRotation"in t&&(n.preRotation=t.PreRotation.value),"Lcl_Rotation"in t&&(n.rotation=t.Lcl_Rotation.value),"PostRotation"in t&&(n.postRotation=t.PostRotation.value),"Lcl_Scaling"in t&&(n.scale=t.Lcl_Scaling.value),"ScalingOffset"in t&&(n.scalingOffset=t.ScalingOffset.value),"ScalingPivot"in t&&(n.scalingPivot=t.ScalingPivot.value),"RotationOffset"in t&&(n.rotationOffset=t.RotationOffset.value),"RotationPivot"in t&&(n.rotationPivot=t.RotationPivot.value),e.userData.transformData=n}setLookAtProperties(e,t){"LookAtProperty"in t&&ge.get(e.ID).children.forEach(function(i){if(i.relationship==="LookAtProperty"){let s=W.Objects.Model[i.ID];if("Lcl_Translation"in s){let r=s.Lcl_Translation.value;e.target!==void 0?(e.target.position.fromArray(r),Ee.add(e.target)):e.lookAt(new M().fromArray(r))}}})}bindSkeleton(e,t,n){let i=this.parsePoseNodes();for(let s in e){let r=e[s];ge.get(parseInt(r.ID)).parents.forEach(function(a){if(t.has(a.ID)){let c=a.ID;ge.get(c).parents.forEach(function(h){n.has(h.ID)&&n.get(h.ID).bind(new en(r.bones),i[h.ID])})}})}}parsePoseNodes(){let e={};if("Pose"in W.Objects){let t=W.Objects.Pose;for(let n in t)if(t[n].attrType==="BindPose"&&t[n].NbPoseNodes>0){let i=t[n].PoseNode;Array.isArray(i)?i.forEach(function(s){e[s.Node]=new D().fromArray(s.Matrix.a)}):e[i.Node]=new D().fromArray(i.Matrix.a)}}return e}addGlobalSceneSettings(){if("GlobalSettings"in W){if("AmbientColor"in W.GlobalSettings){let e=W.GlobalSettings.AmbientColor.value,t=e[0],n=e[1],i=e[2];if(t!==0||n!==0||i!==0){let s=new L().setRGB(t,n,i,O);Ee.add(new ui(s,1))}}"UnitScaleFactor"in W.GlobalSettings&&(Ee.userData.unitScaleFactor=W.GlobalSettings.UnitScaleFactor.value)}}},zo=class{constructor(){this.negativeMaterialIndices=!1}parse(e){let t=new Map;if("Geometry"in W.Objects){let n=W.Objects.Geometry;for(let i in n){let s=ge.get(parseInt(i)),r=this.parseGeometry(s,n[i],e);t.set(parseInt(i),r)}}return this.negativeMaterialIndices===!0&&console.warn("THREE.FBXLoader: The FBX file contains invalid (negative) material indices. The asset might not render as expected."),t}parseGeometry(e,t,n){switch(t.attrType){case"Mesh":return this.parseMeshGeometry(e,t,n);case"NurbsCurve":return this.parseNurbsGeometry(t)}}parseMeshGeometry(e,t,n){let i=n.skeletons,s=[],r=e.parents.map(function(h){return W.Objects.Model[h.ID]});if(r.length===0)return;let o=e.children.reduce(function(h,f){return i[f.ID]!==void 0&&(h=i[f.ID]),h},null);e.children.forEach(function(h){n.morphTargets[h.ID]!==void 0&&s.push(n.morphTargets[h.ID])});let a=r[0],c={};"RotationOrder"in a&&(c.eulerOrder=bi(a.RotationOrder.value)),"InheritType"in a&&(c.inheritType=parseInt(a.InheritType.value)),"GeometricTranslation"in a&&(c.translation=a.GeometricTranslation.value),"GeometricRotation"in a&&(c.rotation=a.GeometricRotation.value),"GeometricScaling"in a&&(c.scale=a.GeometricScaling.value);let u=xc(c);return this.genGeometry(t,o,s,u)}genGeometry(e,t,n,i){let s=new me;e.attrName&&(s.name=e.attrName);let r=this.parseGeoNode(e,t),o=this.genBuffers(r),a=new Q(o.vertex,3);if(a.applyMatrix4(i),s.setAttribute("position",a),o.colors.length>0&&s.setAttribute("color",new Q(o.colors,3)),t&&(s.setAttribute("skinIndex",new Rn(o.weightsIndices,4)),s.setAttribute("skinWeight",new Q(o.vertexWeights,4)),s.FBX_Deformer=t),o.normal.length>0){let c=new k().getNormalMatrix(i),u=new Q(o.normal,3);u.applyNormalMatrix(c),s.setAttribute("normal",u)}if(o.uvs.forEach(function(c,u){let h=u===0?"uv":`uv${u}`;s.setAttribute(h,new Q(o.uvs[u],2))}),r.material&&r.material.mappingType!=="AllSame"){let c=o.materialIndex[0],u=0;if(o.materialIndex.forEach(function(h,f){h!==c&&(s.addGroup(u,f-u,c),c=h,u=f)}),s.groups.length>0){let h=s.groups[s.groups.length-1],f=h.start+h.count;f!==o.materialIndex.length&&s.addGroup(f,o.materialIndex.length-f,c)}s.groups.length===0&&s.addGroup(0,o.materialIndex.length,o.materialIndex[0])}return this.addMorphTargets(s,e,n,i),s}parseGeoNode(e,t){let n={};if(n.vertexPositions=e.Vertices!==void 0?e.Vertices.a:[],n.vertexIndices=e.PolygonVertexIndex!==void 0?e.PolygonVertexIndex.a:[],e.LayerElementColor&&e.LayerElementColor[0].Colors&&(n.color=this.parseVertexColors(e.LayerElementColor[0])),e.LayerElementMaterial&&(n.material=this.parseMaterialIndices(e.LayerElementMaterial[0])),e.LayerElementNormal&&(n.normal=this.parseNormals(e.LayerElementNormal[0])),e.LayerElementUV){n.uv=[];let i=0;for(;e.LayerElementUV[i];)e.LayerElementUV[i].UV&&n.uv.push(this.parseUVs(e.LayerElementUV[i])),i++}return n.weightTable={},t!==null&&(n.skeleton=t,t.rawBones.forEach(function(i,s){i.indices.forEach(function(r,o){n.weightTable[r]===void 0&&(n.weightTable[r]=[]),n.weightTable[r].push({id:s,weight:i.weights[o]})})})),n}genBuffers(e){let t={vertex:[],normal:[],colors:[],uvs:[],materialIndex:[],vertexWeights:[],weightsIndices:[]},n=0,i=0,s=!1,r=[],o=[],a=[],c=[],u=[],h=[],f=this;return e.vertexIndices.forEach(function(d,p){let g,m=!1;d<0&&(d=d^-1,m=!0);let x=[],v=[];if(r.push(d*3,d*3+1,d*3+2),e.color){let y=ys(p,n,d,e.color);a.push(y[0],y[1],y[2])}if(e.skeleton){if(e.weightTable[d]!==void 0&&e.weightTable[d].forEach(function(y){v.push(y.weight),x.push(y.id)}),v.length>4){s||(console.warn("THREE.FBXLoader: Vertex has more than 4 skinning weights assigned to vertex. Deleting additional weights."),s=!0);let y=[0,0,0,0],_=[0,0,0,0];v.forEach(function(S,T){let b=S,w=x[T];_.forEach(function(E,C,A){if(b>E){A[C]=b,b=E;let K=y[C];y[C]=w,w=K}})}),x=y,v=_}for(;v.length<4;)v.push(0),x.push(0);for(let y=0;y<4;++y)u.push(v[y]),h.push(x[y])}if(e.normal){let y=ys(p,n,d,e.normal);o.push(y[0],y[1],y[2])}e.material&&e.material.mappingType!=="AllSame"&&(g=ys(p,n,d,e.material)[0],g<0&&(f.negativeMaterialIndices=!0,g=0)),e.uv&&e.uv.forEach(function(y,_){let S=ys(p,n,d,y);c[_]===void 0&&(c[_]=[]),c[_].push(S[0]),c[_].push(S[1])}),i++,m&&(f.genFace(t,e,r,g,o,a,c,u,h,i),n++,i=0,r=[],o=[],a=[],c=[],u=[],h=[])}),t}getNormalNewell(e){let t=new M(0,0,0);for(let n=0;n<e.length;n++){let i=e[n],s=e[(n+1)%e.length];t.x+=(i.y-s.y)*(i.z+s.z),t.y+=(i.z-s.z)*(i.x+s.x),t.z+=(i.x-s.x)*(i.y+s.y)}return t.normalize(),t}getNormalTangentAndBitangent(e){let t=this.getNormalNewell(e),i=(Math.abs(t.z)>.5?new M(0,1,0):new M(0,0,1)).cross(t).normalize(),s=t.clone().cross(i).normalize();return{normal:t,tangent:i,bitangent:s}}flattenVertex(e,t,n){return new Z(e.dot(t),e.dot(n))}genFace(e,t,n,i,s,r,o,a,c,u){let h;if(u>3){let f=[],d=t.baseVertexPositions||t.vertexPositions;for(let x=0;x<n.length;x+=3)f.push(new M(d[n[x]],d[n[x+1]],d[n[x+2]]));let{tangent:p,bitangent:g}=this.getNormalTangentAndBitangent(f),m=[];for(let x of f)m.push(this.flattenVertex(x,p,g));h=oi.triangulateShape(m,[])}else h=[[0,1,2]];for(let[f,d,p]of h)e.vertex.push(t.vertexPositions[n[f*3]]),e.vertex.push(t.vertexPositions[n[f*3+1]]),e.vertex.push(t.vertexPositions[n[f*3+2]]),e.vertex.push(t.vertexPositions[n[d*3]]),e.vertex.push(t.vertexPositions[n[d*3+1]]),e.vertex.push(t.vertexPositions[n[d*3+2]]),e.vertex.push(t.vertexPositions[n[p*3]]),e.vertex.push(t.vertexPositions[n[p*3+1]]),e.vertex.push(t.vertexPositions[n[p*3+2]]),t.skeleton&&(e.vertexWeights.push(a[f*4]),e.vertexWeights.push(a[f*4+1]),e.vertexWeights.push(a[f*4+2]),e.vertexWeights.push(a[f*4+3]),e.vertexWeights.push(a[d*4]),e.vertexWeights.push(a[d*4+1]),e.vertexWeights.push(a[d*4+2]),e.vertexWeights.push(a[d*4+3]),e.vertexWeights.push(a[p*4]),e.vertexWeights.push(a[p*4+1]),e.vertexWeights.push(a[p*4+2]),e.vertexWeights.push(a[p*4+3]),e.weightsIndices.push(c[f*4]),e.weightsIndices.push(c[f*4+1]),e.weightsIndices.push(c[f*4+2]),e.weightsIndices.push(c[f*4+3]),e.weightsIndices.push(c[d*4]),e.weightsIndices.push(c[d*4+1]),e.weightsIndices.push(c[d*4+2]),e.weightsIndices.push(c[d*4+3]),e.weightsIndices.push(c[p*4]),e.weightsIndices.push(c[p*4+1]),e.weightsIndices.push(c[p*4+2]),e.weightsIndices.push(c[p*4+3])),t.color&&(e.colors.push(r[f*3]),e.colors.push(r[f*3+1]),e.colors.push(r[f*3+2]),e.colors.push(r[d*3]),e.colors.push(r[d*3+1]),e.colors.push(r[d*3+2]),e.colors.push(r[p*3]),e.colors.push(r[p*3+1]),e.colors.push(r[p*3+2])),t.material&&t.material.mappingType!=="AllSame"&&(e.materialIndex.push(i),e.materialIndex.push(i),e.materialIndex.push(i)),t.normal&&(e.normal.push(s[f*3]),e.normal.push(s[f*3+1]),e.normal.push(s[f*3+2]),e.normal.push(s[d*3]),e.normal.push(s[d*3+1]),e.normal.push(s[d*3+2]),e.normal.push(s[p*3]),e.normal.push(s[p*3+1]),e.normal.push(s[p*3+2])),t.uv&&t.uv.forEach(function(g,m){e.uvs[m]===void 0&&(e.uvs[m]=[]),e.uvs[m].push(o[m][f*2]),e.uvs[m].push(o[m][f*2+1]),e.uvs[m].push(o[m][d*2]),e.uvs[m].push(o[m][d*2+1]),e.uvs[m].push(o[m][p*2]),e.uvs[m].push(o[m][p*2+1])})}addMorphTargets(e,t,n,i){if(n.length===0)return;e.morphTargetsRelative=!0,e.morphAttributes.position=[];let s=this;n.forEach(function(r){r.rawTargets.forEach(function(o){let a=W.Objects.Geometry[o.geoID];a!==void 0&&s.genMorphGeometry(e,t,a,i,o.name)})})}genMorphGeometry(e,t,n,i,s){let r=t.Vertices!==void 0?t.Vertices.a:[],o=t.PolygonVertexIndex!==void 0?t.PolygonVertexIndex.a:[],a=n.Vertices!==void 0?n.Vertices.a:[],c=n.Indexes!==void 0?n.Indexes.a:[],u=e.attributes.position.count*3,h=new Float32Array(u);for(let g=0;g<c.length;g++){let m=c[g]*3;h[m]=a[g*3],h[m+1]=a[g*3+1],h[m+2]=a[g*3+2]}let f={vertexIndices:o,vertexPositions:h,baseVertexPositions:r},d=this.genBuffers(f),p=new Q(d.vertex,3);p.name=s||n.attrName,p.applyMatrix4(i),e.morphAttributes.position.push(p)}parseNormals(e){let t=e.MappingInformationType,n=e.ReferenceInformationType,i=e.Normals.a,s=[];return n==="IndexToDirect"&&("NormalIndex"in e?s=e.NormalIndex.a:"NormalsIndex"in e&&(s=e.NormalsIndex.a)),{dataSize:3,buffer:i,indices:s,mappingType:t,referenceType:n}}parseUVs(e){let t=e.MappingInformationType,n=e.ReferenceInformationType,i=e.UV.a,s=[];return n==="IndexToDirect"&&(s=e.UVIndex.a),{dataSize:2,buffer:i,indices:s,mappingType:t,referenceType:n}}parseVertexColors(e){let t=e.MappingInformationType,n=e.ReferenceInformationType,i=e.Colors.a,s=[];n==="IndexToDirect"&&(s=e.ColorIndex.a);for(let r=0,o=new L;r<i.length;r+=4)o.fromArray(i,r),re.colorSpaceToWorking(o,O),o.toArray(i,r);return{dataSize:4,buffer:i,indices:s,mappingType:t,referenceType:n}}parseMaterialIndices(e){let t=e.MappingInformationType,n=e.ReferenceInformationType;if(t==="NoMappingInformation")return{dataSize:1,buffer:[0],indices:[0],mappingType:"AllSame",referenceType:n};let i=e.Materials.a,s=[];for(let r=0;r<i.length;++r)s.push(r);return{dataSize:1,buffer:i,indices:s,mappingType:t,referenceType:n}}parseNurbsGeometry(e){let t=parseInt(e.Order);if(isNaN(t))return console.error("THREE.FBXLoader: Invalid Order %s given for geometry ID: %s",e.Order,e.id),new me;let n=t-1,i=e.KnotVector.a,s=[],r=e.Points.a;for(let h=0,f=r.length;h<f;h+=4)s.push(new he().fromArray(r,h));let o,a;if(e.Form==="Closed")s.push(s[0]);else if(e.Form==="Periodic"){o=n,a=i.length-1-o;for(let h=0;h<n;++h)s.push(s[h])}let u=new _s(n,i,s,o,a).getPoints(s.length*12);return new me().setFromPoints(u)}},ko=class{parse(){let e=[],t=this.parseClips();if(t!==void 0)for(let n in t){let i=t[n],s=this.addClip(i);e.push(s)}return e}parseClips(){if(W.Objects.AnimationCurve===void 0)return;let e=this.parseAnimationCurveNodes();this.parseAnimationCurves(e);let t=this.parseAnimationLayers(e);return this.parseAnimStacks(t)}parseAnimationCurveNodes(){let e=W.Objects.AnimationCurveNode,t=new Map;for(let n in e){let i=e[n];if(i.attrName.match(/S|R|T|DeformPercent/)!==null){let s={id:i.id,attr:i.attrName,curves:{}};t.set(s.id,s)}}return t}parseAnimationCurves(e){let t=W.Objects.AnimationCurve;for(let n in t){let i={id:t[n].id,times:t[n].KeyTime.a.map(nd),values:t[n].KeyValueFloat.a},s=ge.get(i.id);if(s!==void 0){let r=s.parents[0].ID,o=s.parents[0].relationship;o.match(/X/)?e.get(r).curves.x=i:o.match(/Y/)?e.get(r).curves.y=i:o.match(/Z/)?e.get(r).curves.z=i:o.match(/DeformPercent/)&&e.has(r)&&(e.get(r).curves.morph=i)}}}parseAnimationLayers(e){let t=W.Objects.AnimationLayer,n=new Map;for(let i in t){let s=[],r=ge.get(parseInt(i));r!==void 0&&(r.children.forEach(function(a,c){if(e.has(a.ID)){let u=e.get(a.ID);if(u.curves.x!==void 0||u.curves.y!==void 0||u.curves.z!==void 0){if(s[c]===void 0){let h=ge.get(a.ID).parents.filter(function(f){return f.relationship!==void 0})[0].ID;if(h!==void 0){let f=W.Objects.Model[h.toString()];if(f===void 0){console.warn("THREE.FBXLoader: Encountered a unused curve.",a);return}let d={modelName:f.attrName?X.sanitizeNodeName(f.attrName):"",ID:f.id,initialPosition:[0,0,0],initialRotation:[0,0,0],initialScale:[1,1,1]};Ee.traverse(function(p){p.ID===f.id&&(d.transform=p.matrix,p.userData.transformData&&(d.eulerOrder=p.userData.transformData.eulerOrder))}),d.transform||(d.transform=new D),"PreRotation"in f&&(d.preRotation=f.PreRotation.value),"PostRotation"in f&&(d.postRotation=f.PostRotation.value),s[c]=d}}s[c]&&(s[c][u.attr]=u)}else if(u.curves.morph!==void 0){if(s[c]===void 0){let h=ge.get(a.ID).parents.filter(function(x){return x.relationship!==void 0})[0].ID,f=ge.get(h).parents[0].ID,d=ge.get(f).parents[0].ID,p=ge.get(d).parents[0].ID,g=W.Objects.Model[p],m={modelName:g.attrName?X.sanitizeNodeName(g.attrName):"",morphName:W.Objects.Deformer[h].attrName};s[c]=m}s[c][u.attr]=u}}}),n.set(parseInt(i),s))}return n}parseAnimStacks(e){let t=W.Objects.AnimationStack,n={};for(let i in t){let s=ge.get(parseInt(i)).children;s.length>1&&console.warn("THREE.FBXLoader: Encountered an animation stack with multiple layers, this is currently not supported. Ignoring subsequent layers.");let r=e.get(s[0].ID);n[i]={name:t[i].attrName,layer:r}}return n}addClip(e){let t=[],n=this;return e.layer.forEach(function(i){t=t.concat(n.generateTracks(i))}),new sn(e.name,-1,t)}generateTracks(e){let t=[],n=new M,i=new M;if(e.transform&&e.transform.decompose(n,new fe,i),n=n.toArray(),i=i.toArray(),e.T!==void 0&&Object.keys(e.T.curves).length>0){let s=this.generateVectorTrack(e.modelName,e.T.curves,n,"position");s!==void 0&&t.push(s)}if(e.R!==void 0&&Object.keys(e.R.curves).length>0){let s=this.generateRotationTrack(e.modelName,e.R.curves,e.preRotation,e.postRotation,e.eulerOrder);s!==void 0&&t.push(s)}if(e.S!==void 0&&Object.keys(e.S.curves).length>0){let s=this.generateVectorTrack(e.modelName,e.S.curves,i,"scale");s!==void 0&&t.push(s)}if(e.DeformPercent!==void 0){let s=this.generateMorphTrack(e);s!==void 0&&t.push(s)}return t}generateVectorTrack(e,t,n,i){let s=this.getTimesForAllAxes(t),r=this.getKeyframeTrackValues(s,t,n);return new Ke(e+"."+i,s,r)}generateRotationTrack(e,t,n,i,s){let r,o;if(t.x!==void 0&&t.y!==void 0&&t.z!==void 0){let f=this.interpolateRotations(t.x,t.y,t.z,s);r=f[0],o=f[1]}let a=bi(0);n!==void 0&&(n=n.map(pe.degToRad),n.push(a),n=new _e().fromArray(n),n=new fe().setFromEuler(n)),i!==void 0&&(i=i.map(pe.degToRad),i.push(a),i=new _e().fromArray(i),i=new fe().setFromEuler(i).invert());let c=new fe,u=new _e,h=[];if(!o||!r)return new Ve(e+".quaternion",[0],[0]);for(let f=0;f<o.length;f+=3)u.set(o[f],o[f+1],o[f+2],s),c.setFromEuler(u),n!==void 0&&c.premultiply(n),i!==void 0&&c.multiply(i),f>2&&new fe().fromArray(h,(f-3)/3*4).dot(c)<0&&c.set(-c.x,-c.y,-c.z,-c.w),c.toArray(h,f/3*4);return new Ve(e+".quaternion",r,h)}generateMorphTrack(e){let t=e.DeformPercent.curves.morph,n=t.values.map(function(s){return s/100}),i=Ee.getObjectByName(e.modelName).morphTargetDictionary[e.morphName];return new Ye(e.modelName+".morphTargetInfluences["+i+"]",t.times,n)}getTimesForAllAxes(e){let t=[];if(e.x!==void 0&&(t=t.concat(e.x.times)),e.y!==void 0&&(t=t.concat(e.y.times)),e.z!==void 0&&(t=t.concat(e.z.times)),t=t.sort(function(n,i){return n-i}),t.length>1){let n=1,i=t[0];for(let s=1;s<t.length;s++){let r=t[s];r!==i&&(t[n]=r,i=r,n++)}t=t.slice(0,n)}return t}getKeyframeTrackValues(e,t,n){let i=n,s=[],r=-1,o=-1,a=-1;return e.forEach(function(c){if(t.x&&(r=t.x.times.indexOf(c)),t.y&&(o=t.y.times.indexOf(c)),t.z&&(a=t.z.times.indexOf(c)),r!==-1){let u=t.x.values[r];s.push(u),i[0]=u}else s.push(i[0]);if(o!==-1){let u=t.y.values[o];s.push(u),i[1]=u}else s.push(i[1]);if(a!==-1){let u=t.z.values[a];s.push(u),i[2]=u}else s.push(i[2])}),s}interpolateRotations(e,t,n,i){let s=[],r=[];s.push(e.times[0]),r.push(pe.degToRad(e.values[0])),r.push(pe.degToRad(t.values[0])),r.push(pe.degToRad(n.values[0]));for(let o=1;o<e.values.length;o++){let a=[e.values[o-1],t.values[o-1],n.values[o-1]];if(isNaN(a[0])||isNaN(a[1])||isNaN(a[2]))continue;let c=a.map(pe.degToRad),u=[e.values[o],t.values[o],n.values[o]];if(isNaN(u[0])||isNaN(u[1])||isNaN(u[2]))continue;let h=u.map(pe.degToRad),f=[u[0]-a[0],u[1]-a[1],u[2]-a[2]],d=[Math.abs(f[0]),Math.abs(f[1]),Math.abs(f[2])];if(d[0]>=180||d[1]>=180||d[2]>=180){let g=Math.max(...d)/180,m=new _e(...c,i),x=new _e(...h,i),v=new fe().setFromEuler(m),y=new fe().setFromEuler(x);v.dot(y)&&y.set(-y.x,-y.y,-y.z,-y.w);let _=e.times[o-1],S=e.times[o]-_,T=new fe,b=new _e;for(let w=0;w<1;w+=1/g)T.copy(v.clone().slerp(y.clone(),w)),s.push(_+w*S),b.setFromQuaternion(T,i),r.push(b.x),r.push(b.y),r.push(b.z)}else s.push(e.times[o]),r.push(pe.degToRad(e.values[o])),r.push(pe.degToRad(t.values[o])),r.push(pe.degToRad(n.values[o]))}return[s,r]}},Vo=class{getPrevNode(){return this.nodeStack[this.currentIndent-2]}getCurrentNode(){return this.nodeStack[this.currentIndent-1]}getCurrentProp(){return this.currentProp}pushStack(e){this.nodeStack.push(e),this.currentIndent+=1}popStack(){this.nodeStack.pop(),this.currentIndent-=1}setCurrentProp(e,t){this.currentProp=e,this.currentPropName=t}parse(e){this.currentIndent=0,this.allNodes=new Ss,this.nodeStack=[],this.currentProp=[],this.currentPropName="";let t=this,n=e.split(/[\r\n]+/);return n.forEach(function(i,s){let r=i.match(/^[\s\t]*;/),o=i.match(/^[\s\t]*$/);if(r||o)return;let a=i.match("^\\t{"+t.currentIndent+"}(\\w+):(.*){",""),c=i.match("^\\t{"+t.currentIndent+"}(\\w+):[\\s\\t\\r\\n](.*)"),u=i.match("^\\t{"+(t.currentIndent-1)+"}}");a?t.parseNodeBegin(i,a):c?t.parseNodeProperty(i,c,n[++s]):u?t.popStack():i.match(/^[^\s\t}]/)&&t.parseNodePropertyContinued(i)}),this.allNodes}parseNodeBegin(e,t){let n=t[1].trim().replace(/^"/,"").replace(/"$/,""),i=t[2].split(",").map(function(a){return a.trim().replace(/^"/,"").replace(/"$/,"")}),s={name:n},r=this.parseNodeAttr(i),o=this.getCurrentNode();this.currentIndent===0?this.allNodes.add(n,s):n in o?(n==="PoseNode"?o.PoseNode.push(s):o[n].id!==void 0&&(o[n]={},o[n][o[n].id]=o[n]),r.id!==""&&(o[n][r.id]=s)):typeof r.id=="number"?(o[n]={},o[n][r.id]=s):n!=="Properties70"&&(n==="PoseNode"?o[n]=[s]:o[n]=s),typeof r.id=="number"&&(s.id=r.id),r.name!==""&&(s.attrName=r.name),r.type!==""&&(s.attrType=r.type),this.pushStack(s)}parseNodeAttr(e){let t=e[0];e[0]!==""&&(t=parseInt(e[0]),isNaN(t)&&(t=e[0]));let n="",i="";return e.length>1&&(n=e[1].replace(/^(\w+)::/,""),i=e[2]),{id:t,name:n,type:i}}parseNodeProperty(e,t,n){let i=t[1].replace(/^"/,"").replace(/"$/,"").trim(),s=t[2].replace(/^"/,"").replace(/"$/,"").trim();i==="Content"&&s===","&&(s=n.replace(/"/g,"").replace(/,$/,"").trim());let r=this.getCurrentNode();if(r.name==="Properties70"){this.parseNodeSpecialProperty(e,i,s);return}if(i==="C"){let a=s.split(",").slice(1),c=parseInt(a[0]),u=parseInt(a[1]),h=s.split(",").slice(3);h=h.map(function(f){return f.trim().replace(/^"/,"")}),i="connections",s=[c,u],sd(s,h),r[i]===void 0&&(r[i]=[])}i==="Node"&&(r.id=s),i in r&&Array.isArray(r[i])?r[i].push(s):i!=="a"?r[i]=s:r.a=s,this.setCurrentProp(r,i),i==="a"&&s.slice(-1)!==","&&(r.a=Oo(s))}parseNodePropertyContinued(e){let t=this.getCurrentNode();t.a+=e,e.slice(-1)!==","&&(t.a=Oo(t.a))}parseNodeSpecialProperty(e,t,n){let i=n.split('",').map(function(u){return u.trim().replace(/^\"/,"").replace(/\s/,"_")}),s=i[0],r=i[1],o=i[2],a=i[3],c=i[4];switch(r){case"int":case"enum":case"bool":case"ULongLong":case"double":case"Number":case"FieldOfView":c=parseFloat(c);break;case"Color":case"ColorRGB":case"Vector3D":case"Lcl_Translation":case"Lcl_Rotation":case"Lcl_Scaling":c=Oo(c);break}this.getPrevNode()[s]={type:r,type2:o,flag:a,value:c},this.setCurrentProp(this.getPrevNode(),s)}},Ho=class{parse(e){let t=new Ms(e);t.skip(23);let n=t.getUint32();if(n<6400)throw new Error("THREE.FBXLoader: FBX version not supported, FileVersion: "+n);let i=new Ss;for(;!this.endOfContent(t);){let s=this.parseNode(t,n);s!==null&&i.add(s.name,s)}return i}endOfContent(e){return e.size()%16===0?(e.getOffset()+160+16&-16)>=e.size():e.getOffset()+160+16>=e.size()}parseNode(e,t){let n={},i=t>=7500?e.getUint64():e.getUint32(),s=t>=7500?e.getUint64():e.getUint32();t>=7500?e.getUint64():e.getUint32();let r=e.getUint8(),o=e.getString(r);if(i===0)return null;let a=[];for(let f=0;f<s;f++)a.push(this.parseProperty(e));let c=a.length>0?a[0]:"",u=a.length>1?a[1]:"",h=a.length>2?a[2]:"";for(n.singleProperty=s===1&&e.getOffset()===i;i>e.getOffset();){let f=this.parseNode(e,t);f!==null&&this.parseSubNode(o,n,f)}return n.propertyList=a,typeof c=="number"&&(n.id=c),u!==""&&(n.attrName=u),h!==""&&(n.attrType=h),o!==""&&(n.name=o),n}parseSubNode(e,t,n){if(n.singleProperty===!0){let i=n.propertyList[0];Array.isArray(i)?(t[n.name]=n,n.a=i):t[n.name]=i}else if(e==="Connections"&&n.name==="C"){let i=[];n.propertyList.forEach(function(s,r){r!==0&&i.push(s)}),t.connections===void 0&&(t.connections=[]),t.connections.push(i)}else if(n.name==="Properties70")Object.keys(n).forEach(function(s){t[s]=n[s]});else if(e==="Properties70"&&n.name==="P"){let i=n.propertyList[0],s=n.propertyList[1],r=n.propertyList[2],o=n.propertyList[3],a;i.indexOf("Lcl ")===0&&(i=i.replace("Lcl ","Lcl_")),s.indexOf("Lcl ")===0&&(s=s.replace("Lcl ","Lcl_")),s==="Color"||s==="ColorRGB"||s==="Vector"||s==="Vector3D"||s.indexOf("Lcl_")===0?a=[n.propertyList[4],n.propertyList[5],n.propertyList[6]]:a=n.propertyList[4],t[i]={type:s,type2:r,flag:o,value:a}}else t[n.name]===void 0?typeof n.id=="number"?(t[n.name]={},t[n.name][n.id]=n):t[n.name]=n:n.name==="PoseNode"?(Array.isArray(t[n.name])||(t[n.name]=[t[n.name]]),t[n.name].push(n)):t[n.name][n.id]===void 0&&(t[n.name][n.id]=n)}parseProperty(e){let t=e.getString(1),n;switch(t){case"C":return e.getBoolean();case"D":return e.getFloat64();case"F":return e.getFloat32();case"I":return e.getInt32();case"L":return e.getInt64();case"R":return n=e.getUint32(),e.getArrayBuffer(n);case"S":return n=e.getUint32(),e.getString(n);case"Y":return e.getInt16();case"b":case"c":case"d":case"f":case"i":case"l":let i=e.getUint32(),s=e.getUint32(),r=e.getUint32();if(s===0)switch(t){case"b":case"c":return e.getBooleanArray(i);case"d":return e.getFloat64Array(i);case"f":return e.getFloat32Array(i);case"i":return e.getInt32Array(i);case"l":return e.getInt64Array(i)}let o=fc(new Uint8Array(e.getArrayBuffer(r))),a=new Ms(o.buffer);switch(t){case"b":case"c":return a.getBooleanArray(i);case"d":return a.getFloat64Array(i);case"f":return a.getFloat32Array(i);case"i":return a.getInt32Array(i);case"l":return a.getInt64Array(i)}break;default:throw new Error("THREE.FBXLoader: Unknown property type "+t)}}},Ms=class{constructor(e,t){this.dv=new DataView(e),this.offset=0,this.littleEndian=t!==void 0?t:!0,this._textDecoder=new TextDecoder}getOffset(){return this.offset}size(){return this.dv.buffer.byteLength}skip(e){this.offset+=e}getBoolean(){return(this.getUint8()&1)===1}getBooleanArray(e){let t=[];for(let n=0;n<e;n++)t.push(this.getBoolean());return t}getUint8(){let e=this.dv.getUint8(this.offset);return this.offset+=1,e}getInt16(){let e=this.dv.getInt16(this.offset,this.littleEndian);return this.offset+=2,e}getInt32(){let e=this.dv.getInt32(this.offset,this.littleEndian);return this.offset+=4,e}getInt32Array(e){let t=[];for(let n=0;n<e;n++)t.push(this.getInt32());return t}getUint32(){let e=this.dv.getUint32(this.offset,this.littleEndian);return this.offset+=4,e}getInt64(){let e,t;return this.littleEndian?(e=this.getUint32(),t=this.getUint32()):(t=this.getUint32(),e=this.getUint32()),t&2147483648?(t=~t&4294967295,e=~e&4294967295,e===4294967295&&(t=t+1&4294967295),e=e+1&4294967295,-(t*4294967296+e)):t*4294967296+e}getInt64Array(e){let t=[];for(let n=0;n<e;n++)t.push(this.getInt64());return t}getUint64(){let e,t;return this.littleEndian?(e=this.getUint32(),t=this.getUint32()):(t=this.getUint32(),e=this.getUint32()),t*4294967296+e}getFloat32(){let e=this.dv.getFloat32(this.offset,this.littleEndian);return this.offset+=4,e}getFloat32Array(e){let t=[];for(let n=0;n<e;n++)t.push(this.getFloat32());return t}getFloat64(){let e=this.dv.getFloat64(this.offset,this.littleEndian);return this.offset+=8,e}getFloat64Array(e){let t=[];for(let n=0;n<e;n++)t.push(this.getFloat64());return t}getArrayBuffer(e){let t=this.dv.buffer.slice(this.offset,this.offset+e);return this.offset+=e,t}getString(e){let t=this.offset,n=new Uint8Array(this.dv.buffer,t,e);this.skip(e);let i=n.indexOf(0);return i>=0&&(n=new Uint8Array(this.dv.buffer,t,i)),this._textDecoder.decode(n)}},Ss=class{add(e,t){this[e]=t}};function ed(l){let e="Kaydara FBX Binary  \0";return l.byteLength>=e.length&&e===_c(l,0,e.length)}function td(l){let e=["K","a","y","d","a","r","a","\\","F","B","X","\\","B","i","n","a","r","y","\\","\\"],t=0;function n(i){let s=l[i-1];return l=l.slice(t+i),t++,s}for(let i=0;i<e.length;++i)if(n(1)===e[i])return!1;return!0}function gc(l){let e=/FBXVersion: (\d+)/,t=l.match(e);if(t)return parseInt(t[1]);throw new Error("THREE.FBXLoader: Cannot find the version number for the file given.")}function nd(l){return l/46186158e3}var id=[];function ys(l,e,t,n){let i;switch(n.mappingType){case"ByPolygonVertex":i=l;break;case"ByPolygon":i=e;break;case"ByVertice":i=t;break;case"AllSame":i=n.indices[0];break;default:console.warn("THREE.FBXLoader: unknown attribute mapping type "+n.mappingType)}n.referenceType==="IndexToDirect"&&(i=n.indices[i]);let s=i*n.dataSize,r=s+n.dataSize;return rd(id,n.buffer,s,r)}var Fo=new _e,kn=new M;function xc(l){let e=new D,t=new D,n=new D,i=new D,s=new D,r=new D,o=new D,a=new D,c=new D,u=new D,h=new D,f=new D,d=l.inheritType?l.inheritType:0;l.translation&&e.setPosition(kn.fromArray(l.translation));let p=bi(0);if(l.preRotation){let A=l.preRotation.map(pe.degToRad);A.push(p),t.makeRotationFromEuler(Fo.fromArray(A))}if(l.rotation){let A=l.rotation.map(pe.degToRad);A.push(l.eulerOrder||p),n.makeRotationFromEuler(Fo.fromArray(A))}if(l.postRotation){let A=l.postRotation.map(pe.degToRad);A.push(p),i.makeRotationFromEuler(Fo.fromArray(A)),i.invert()}l.scale&&s.scale(kn.fromArray(l.scale)),l.scalingOffset&&o.setPosition(kn.fromArray(l.scalingOffset)),l.scalingPivot&&r.setPosition(kn.fromArray(l.scalingPivot)),l.rotationOffset&&a.setPosition(kn.fromArray(l.rotationOffset)),l.rotationPivot&&c.setPosition(kn.fromArray(l.rotationPivot)),l.parentMatrixWorld&&(h.copy(l.parentMatrix),u.copy(l.parentMatrixWorld));let g=t.clone().multiply(n).multiply(i),m=new D;m.extractRotation(u);let x=new D;x.copyPosition(u);let v=x.clone().invert().multiply(u),y=m.clone().invert().multiply(v),_=s,S=new D;if(d===0)S.copy(m).multiply(g).multiply(y).multiply(_);else if(d===1)S.copy(m).multiply(y).multiply(g).multiply(_);else{let K=new D().scale(new M().setFromMatrixScale(h)).clone().invert(),$=y.clone().multiply(K);S.copy(m).multiply(g).multiply($).multiply(_)}let T=c.clone().invert(),b=r.clone().invert(),w=e.clone().multiply(a).multiply(c).multiply(t).multiply(n).multiply(i).multiply(T).multiply(o).multiply(r).multiply(s).multiply(b),E=new D().copyPosition(w),C=u.clone().multiply(E);return f.copyPosition(C),w=f.clone().multiply(S),w.premultiply(u.invert()),w}function bi(l){l=l||0;let e=["ZYX","YZX","XZY","ZXY","YXZ","XYZ"];return l===6?(console.warn("THREE.FBXLoader: unsupported Euler Order: Spherical XYZ. Animations and rotations may be incorrect."),e[0]):e[l]}function Oo(l){return l.split(",").map(function(t){return parseFloat(t)})}function _c(l,e,t){return e===void 0&&(e=0),t===void 0&&(t=l.byteLength),new TextDecoder().decode(new Uint8Array(l,e,t))}function sd(l,e){for(let t=0,n=l.length,i=e.length;t<i;t++,n++)l[n]=e[t]}function rd(l,e,t,n){for(let i=t,s=0;i<n;i++,s++)l[s]=e[i];return l}var od=/^[og]\s*(.+)?/,ad=/^mtllib /,cd=/^usemtl /,ld=/^usemap /,yc=/\s+/,vc=new M,Go=new M,Mc=new M,Sc=new M,je=new M,Ts=new L;function hd(){let l={objects:[],object:{},vertices:[],normals:[],colors:[],uvs:[],materials:{},materialLibraries:[],startObject:function(e,t){if(this.object&&this.object.fromDeclaration===!1){this.object.name=e,this.object.fromDeclaration=t!==!1;return}let n=this.object&&typeof this.object.currentMaterial=="function"?this.object.currentMaterial():void 0;if(this.object&&typeof this.object._finalize=="function"&&this.object._finalize(!0),this.object={name:e||"",fromDeclaration:t!==!1,geometry:{vertices:[],normals:[],colors:[],uvs:[],hasUVIndices:!1},materials:[],smooth:!0,startMaterial:function(i,s){let r=this._finalize(!1);r&&(r.inherited||r.groupCount<=0)&&this.materials.splice(r.index,1);let o={index:this.materials.length,name:i||"",mtllib:Array.isArray(s)&&s.length>0?s[s.length-1]:"",smooth:r!==void 0?r.smooth:this.smooth,groupStart:r!==void 0?r.groupEnd:0,groupEnd:-1,groupCount:-1,inherited:!1,clone:function(a){let c={index:typeof a=="number"?a:this.index,name:this.name,mtllib:this.mtllib,smooth:this.smooth,groupStart:0,groupEnd:-1,groupCount:-1,inherited:!1};return c.clone=this.clone.bind(c),c}};return this.materials.push(o),o},currentMaterial:function(){if(this.materials.length>0)return this.materials[this.materials.length-1]},_finalize:function(i){let s=this.currentMaterial();if(s&&s.groupEnd===-1&&(s.groupEnd=this.geometry.vertices.length/3,s.groupCount=s.groupEnd-s.groupStart,s.inherited=!1),i&&this.materials.length>1)for(let r=this.materials.length-1;r>=0;r--)this.materials[r].groupCount<=0&&this.materials.splice(r,1);return i&&this.materials.length===0&&this.materials.push({name:"",smooth:this.smooth}),s}},n&&n.name&&typeof n.clone=="function"){let i=n.clone(0);i.inherited=!0,this.object.materials.push(i)}this.objects.push(this.object)},finalize:function(){this.object&&typeof this.object._finalize=="function"&&this.object._finalize(!0)},parseVertexIndex:function(e,t){let n=parseInt(e,10);return(n>=0?n-1:n+t/3)*3},parseNormalIndex:function(e,t){let n=parseInt(e,10);return(n>=0?n-1:n+t/3)*3},parseUVIndex:function(e,t){let n=parseInt(e,10);return(n>=0?n-1:n+t/2)*2},addVertex:function(e,t,n){let i=this.vertices,s=this.object.geometry.vertices;s.push(i[e+0],i[e+1],i[e+2]),s.push(i[t+0],i[t+1],i[t+2]),s.push(i[n+0],i[n+1],i[n+2])},addVertexPoint:function(e){let t=this.vertices;this.object.geometry.vertices.push(t[e+0],t[e+1],t[e+2])},addVertexLine:function(e){let t=this.vertices;this.object.geometry.vertices.push(t[e+0],t[e+1],t[e+2])},addNormal:function(e,t,n){let i=this.normals,s=this.object.geometry.normals;s.push(i[e+0],i[e+1],i[e+2]),s.push(i[t+0],i[t+1],i[t+2]),s.push(i[n+0],i[n+1],i[n+2])},addFaceNormal:function(e,t,n){let i=this.vertices,s=this.object.geometry.normals;vc.fromArray(i,e),Go.fromArray(i,t),Mc.fromArray(i,n),je.subVectors(Mc,Go),Sc.subVectors(vc,Go),je.cross(Sc),je.normalize(),s.push(je.x,je.y,je.z),s.push(je.x,je.y,je.z),s.push(je.x,je.y,je.z)},addColor:function(e,t,n){let i=this.colors,s=this.object.geometry.colors;i[e]!==void 0&&s.push(i[e+0],i[e+1],i[e+2]),i[t]!==void 0&&s.push(i[t+0],i[t+1],i[t+2]),i[n]!==void 0&&s.push(i[n+0],i[n+1],i[n+2])},addUV:function(e,t,n){let i=this.uvs,s=this.object.geometry.uvs;s.push(i[e+0],i[e+1]),s.push(i[t+0],i[t+1]),s.push(i[n+0],i[n+1])},addDefaultUV:function(){let e=this.object.geometry.uvs;e.push(0,0),e.push(0,0),e.push(0,0)},addUVLine:function(e){let t=this.uvs;this.object.geometry.uvs.push(t[e+0],t[e+1])},addFace:function(e,t,n,i,s,r,o,a,c){let u=this.vertices.length,h=this.parseVertexIndex(e,u),f=this.parseVertexIndex(t,u),d=this.parseVertexIndex(n,u);if(this.addVertex(h,f,d),this.addColor(h,f,d),o!==void 0&&o!==""){let p=this.normals.length;h=this.parseNormalIndex(o,p),f=this.parseNormalIndex(a,p),d=this.parseNormalIndex(c,p),this.addNormal(h,f,d)}else this.addFaceNormal(h,f,d);if(i!==void 0&&i!==""){let p=this.uvs.length;h=this.parseUVIndex(i,p),f=this.parseUVIndex(s,p),d=this.parseUVIndex(r,p),this.addUV(h,f,d),this.object.geometry.hasUVIndices=!0}else this.addDefaultUV()},addPointGeometry:function(e){this.object.geometry.type="Points";let t=this.vertices.length;for(let n=0,i=e.length;n<i;n++){let s=this.parseVertexIndex(e[n],t);this.addVertexPoint(s),this.addColor(s)}},addLineGeometry:function(e,t){this.object.geometry.type="Line";let n=this.vertices.length,i=this.uvs.length;for(let s=0,r=e.length;s<r;s++)this.addVertexLine(this.parseVertexIndex(e[s],n));for(let s=0,r=t.length;s<r;s++)this.addUVLine(this.parseUVIndex(t[s],i))}};return l.startObject("",!1),l}var bs=class extends de{constructor(e){super(e),this.materials=null}load(e,t,n,i){let s=this,r=new ve(this.manager);r.setPath(this.path),r.setRequestHeader(this.requestHeader),r.setWithCredentials(this.withCredentials),r.load(e,function(o){try{t(s.parse(o))}catch(a){i?i(a):console.error(a),s.manager.itemError(e)}},n,i)}setMaterials(e){return this.materials=e,this}parse(e){let t=new hd;e.indexOf(`\r
`)!==-1&&(e=e.replace(/\r\n/g,`
`)),e.indexOf(`\\
`)!==-1&&(e=e.replace(/\\\n/g,""));let n=e.split(`
`),i=[];for(let o=0,a=n.length;o<a;o++){let c=n[o].trimStart();if(c.length===0)continue;let u=c.charAt(0);if(u!=="#")if(u==="v"){let h=c.split(yc);switch(h[0]){case"v":t.vertices.push(parseFloat(h[1]),parseFloat(h[2]),parseFloat(h[3])),h.length>=7?(Ts.setRGB(parseFloat(h[4]),parseFloat(h[5]),parseFloat(h[6]),O),t.colors.push(Ts.r,Ts.g,Ts.b)):t.colors.push(void 0,void 0,void 0);break;case"vn":t.normals.push(parseFloat(h[1]),parseFloat(h[2]),parseFloat(h[3]));break;case"vt":t.uvs.push(parseFloat(h[1]),parseFloat(h[2]));break}}else if(u==="f"){let f=c.slice(1).trim().split(yc),d=[];for(let g=0,m=f.length;g<m;g++){let x=f[g];if(x.length>0){let v=x.split("/");d.push(v)}}let p=d[0];for(let g=1,m=d.length-1;g<m;g++){let x=d[g],v=d[g+1];t.addFace(p[0],x[0],v[0],p[1],x[1],v[1],p[2],x[2],v[2])}}else if(u==="l"){let h=c.substring(1).trim().split(" "),f=[],d=[];if(c.indexOf("/")===-1)f=h;else for(let p=0,g=h.length;p<g;p++){let m=h[p].split("/");m[0]!==""&&f.push(m[0]),m[1]!==""&&d.push(m[1])}t.addLineGeometry(f,d)}else if(u==="p"){let f=c.slice(1).trim().split(" ");t.addPointGeometry(f)}else if((i=od.exec(c))!==null){let h=(" "+i[0].slice(1).trim()).slice(1);t.startObject(h)}else if(cd.test(c))t.object.startMaterial(c.substring(7).trim(),t.materialLibraries);else if(ad.test(c))t.materialLibraries.push(c.substring(7).trim());else if(ld.test(c))console.warn('THREE.OBJLoader: Rendering identifier "usemap" not supported. Textures must be defined in MTL files.');else if(u==="s"){if(i=c.split(" "),i.length>1){let f=i[1].trim().toLowerCase();t.object.smooth=f!=="0"&&f!=="off"}else t.object.smooth=!0;let h=t.object.currentMaterial();h&&(h.smooth=t.object.smooth)}else{if(c==="\0")continue;console.warn('THREE.OBJLoader: Unexpected line: "'+c+'"')}}t.finalize();let s=new Le;if(s.materialLibraries=[].concat(t.materialLibraries),!(t.objects.length===1&&t.objects[0].geometry.vertices.length===0)===!0)for(let o=0,a=t.objects.length;o<a;o++){let c=t.objects[o],u=c.geometry,h=c.materials,f=u.type==="Line",d=u.type==="Points",p=!1;if(u.vertices.length===0)continue;let g=new me;g.setAttribute("position",new Q(u.vertices,3)),u.normals.length>0&&g.setAttribute("normal",new Q(u.normals,3)),u.colors.length>0&&(p=!0,g.setAttribute("color",new Q(u.colors,3))),u.hasUVIndices===!0&&g.setAttribute("uv",new Q(u.uvs,2));let m=[];for(let v=0,y=h.length;v<y;v++){let _=h[v],S=_.name+"_"+_.smooth+"_"+p,T=t.materials[S];if(this.materials!==null){if(T=this.materials.create(_.name),f&&T&&!(T instanceof Xe)){let b=new Xe;Te.prototype.copy.call(b,T),b.color.copy(T.color),T=b}else if(d&&T&&!(T instanceof st)){let b=new st({size:10,sizeAttenuation:!1});Te.prototype.copy.call(b,T),b.color.copy(T.color),b.map=T.map,T=b}}T===void 0&&(f?T=new Xe:d?T=new st({size:1,sizeAttenuation:!1}):T=new qe,T.name=_.name,T.flatShading=!_.smooth,T.vertexColors=p,t.materials[S]=T),m.push(T)}let x;if(m.length>1){for(let v=0,y=h.length;v<y;v++){let _=h[v];g.addGroup(_.groupStart,_.groupCount,v)}f?x=new Ht(g,m):d?x=new wt(g,m):x=new we(g,m)}else f?x=new Ht(g,m[0]):d?x=new wt(g,m[0]):x=new we(g,m[0]);x.name=c.name,s.add(x)}else if(t.vertices.length>0){let o=new st({size:1,sizeAttenuation:!1}),a=new me;a.setAttribute("position",new Q(t.vertices,3)),t.colors.length>0&&t.colors[0]!==void 0&&(a.setAttribute("color",new Q(t.colors,3)),o.vertexColors=!0);let c=new wt(a,o);s.add(c)}return s}};var ws=class extends de{constructor(e){super(e)}load(e,t,n,i){let s=this,r=this.path===""?He.extractUrlBase(e):this.path,o=new ve(this.manager);o.setPath(this.path),o.setRequestHeader(this.requestHeader),o.setWithCredentials(this.withCredentials),o.load(e,function(a){try{t(s.parse(a,r))}catch(c){i?i(c):console.error(c),s.manager.itemError(e)}},n,i)}setMaterialOptions(e){return this.materialOptions=e,this}parse(e,t){let n=e.split(`
`),i={},s=/\s+/,r={};for(let a=0;a<n.length;a++){let c=n[a];if(c=c.trim(),c.length===0||c.charAt(0)==="#")continue;let u=c.indexOf(" "),h=u>=0?c.substring(0,u):c;h=h.toLowerCase();let f=u>=0?c.substring(u+1):"";if(f=f.trim(),h==="newmtl")i={name:f},r[f]=i;else if(h==="ka"||h==="kd"||h==="ks"||h==="ke"){let d=f.split(s,3);i[h]=[parseFloat(d[0]),parseFloat(d[1]),parseFloat(d[2])]}else i[h]=f}let o=new Wo(this.resourcePath||t,this.materialOptions);return o.setCrossOrigin(this.crossOrigin),o.setManager(this.manager),o.setMaterials(r),o}},Wo=class{constructor(e="",t={}){this.baseUrl=e,this.options=t,this.materialsInfo={},this.materials={},this.materialsArray=[],this.nameLookup={},this.crossOrigin="anonymous",this.side=this.options.side!==void 0?this.options.side:zt,this.wrap=this.options.wrap!==void 0?this.options.wrap:Ce}setCrossOrigin(e){return this.crossOrigin=e,this}setManager(e){this.manager=e}setMaterials(e){this.materialsInfo=this.convert(e),this.materials={},this.materialsArray=[],this.nameLookup={}}convert(e){if(!this.options)return e;let t={};for(let n in e){let i=e[n],s={};t[n]=s;for(let r in i){let o=!0,a=i[r],c=r.toLowerCase();switch(c){case"kd":case"ka":case"ks":this.options&&this.options.normalizeRGB&&(a=[a[0]/255,a[1]/255,a[2]/255]),this.options&&this.options.ignoreZeroRGBs&&a[0]===0&&a[1]===0&&a[2]===0&&(o=!1);break;default:break}o&&(s[c]=a)}}return t}preload(){for(let e in this.materialsInfo)this.create(e)}getIndex(e){return this.nameLookup[e]}getAsArray(){let e=0;for(let t in this.materialsInfo)this.materialsArray[e]=this.create(t),this.nameLookup[t]=e,e++;return this.materialsArray}create(e){return this.materials[e]===void 0&&this.createMaterial_(e),this.materials[e]}createMaterial_(e){let t=this,n=this.materialsInfo[e],i={name:e,side:this.side};function s(o,a){return typeof a!="string"||a===""?"":/^https?:\/\//i.test(a)?a:o+a}function r(o,a){if(i[o])return;let c=t.getTextureParams(a,i),u=t.loadTexture(s(t.baseUrl,c.url));u.repeat.copy(c.scale),u.offset.copy(c.offset),u.wrapS=t.wrap,u.wrapT=t.wrap,(o==="map"||o==="emissiveMap")&&(u.colorSpace=O),i[o]=u}for(let o in n){let a=n[o],c;if(a!=="")switch(o.toLowerCase()){case"kd":i.color=re.colorSpaceToWorking(new L().fromArray(a),O);break;case"ks":i.specular=re.colorSpaceToWorking(new L().fromArray(a),O);break;case"ke":i.emissive=re.colorSpaceToWorking(new L().fromArray(a),O);break;case"map_kd":r("map",a);break;case"map_ks":r("specularMap",a);break;case"map_ke":r("emissiveMap",a);break;case"norm":r("normalMap",a);break;case"map_bump":case"bump":r("bumpMap",a);break;case"disp":r("displacementMap",a);break;case"map_d":r("alphaMap",a),i.transparent=!0;break;case"ns":i.shininess=parseFloat(a);break;case"d":c=parseFloat(a),c<1&&(i.opacity=c,i.transparent=!0);break;case"tr":c=parseFloat(a),this.options&&this.options.invertTrProperty&&(c=1-c),c>0&&(i.opacity=1-c,i.transparent=!0);break;default:break}}return this.materials[e]=new qe(i),this.materials[e]}getTextureParams(e,t){let n={scale:new Z(1,1),offset:new Z(0,0)},i=e.split(/\s+/),s;return s=i.indexOf("-bm"),s>=0&&(t.bumpScale=parseFloat(i[s+1]),i.splice(s,2)),s=i.indexOf("-mm"),s>=0&&(t.displacementBias=parseFloat(i[s+1]),t.displacementScale=parseFloat(i[s+2]),i.splice(s,3)),s=i.indexOf("-s"),s>=0&&(n.scale.set(parseFloat(i[s+1]),parseFloat(i[s+2])),i.splice(s,4)),s=i.indexOf("-o"),s>=0&&(n.offset.set(parseFloat(i[s+1]),parseFloat(i[s+2])),i.splice(s,4)),n.url=i.join(" ").trim(),n}loadTexture(e,t,n,i,s){let r=this.manager!==void 0?this.manager:ms,o=r.getHandler(e);o===null&&(o=new Ct(r)),o.setCrossOrigin&&o.setCrossOrigin(this.crossOrigin);let a=o.load(e,n,i,s);return t!==void 0&&(a.mapping=t),a}};var As=class extends de{constructor(e){super(e)}load(e,t,n,i){let s=this,r=new ve(this.manager);r.setPath(this.path),r.setResponseType("arraybuffer"),r.setRequestHeader(this.requestHeader),r.setWithCredentials(this.withCredentials),r.load(e,function(o){try{t(s.parse(o))}catch(a){i?i(a):console.error(a),s.manager.itemError(e)}},n,i)}parse(e){function t(c){let u=new DataView(c),h=32/8*3+32/8*3*3+16/8,f=u.getUint32(80,!0);if(80+32/8+f*h===u.byteLength)return!0;let p=[115,111,108,105,100];for(let g=0;g<5;g++)if(n(p,u,g))return!1;return!0}function n(c,u,h){for(let f=0,d=c.length;f<d;f++)if(c[f]!==u.getUint8(h+f))return!1;return!0}function i(c){let u=new DataView(c),h=u.getUint32(80,!0),f,d,p,g=!1,m,x,v,y,_;for(let A=0;A<70;A++)u.getUint32(A,!1)==1129270351&&u.getUint8(A+4)==82&&u.getUint8(A+5)==61&&(g=!0,m=new Float32Array(h*3*3),x=u.getUint8(A+6)/255,v=u.getUint8(A+7)/255,y=u.getUint8(A+8)/255,_=u.getUint8(A+9)/255);let S=84,T=50,b=new me,w=new Float32Array(h*3*3),E=new Float32Array(h*3*3),C=new L;for(let A=0;A<h;A++){let K=S+A*T,$=u.getFloat32(K,!0),le=u.getFloat32(K+4,!0),te=u.getFloat32(K+8,!0);if(g){let R=u.getUint16(K+48,!0);(R&32768)===0?(f=(R&31)/31,d=(R>>5&31)/31,p=(R>>10&31)/31):(f=x,d=v,p=y)}for(let R=1;R<=3;R++){let V=K+R*12,z=A*3*3+(R-1)*3;w[z]=u.getFloat32(V,!0),w[z+1]=u.getFloat32(V+4,!0),w[z+2]=u.getFloat32(V+8,!0),E[z]=$,E[z+1]=le,E[z+2]=te,g&&(C.setRGB(f,d,p,O),m[z]=C.r,m[z+1]=C.g,m[z+2]=C.b)}}return b.setAttribute("position",new se(w,3)),b.setAttribute("normal",new se(E,3)),g&&(b.setAttribute("color",new se(m,3)),b.hasColors=!0,b.alpha=_),b}function s(c){let u=new me,h=/solid([\s\S]*?)endsolid/g,f=/facet([\s\S]*?)endfacet/g,d=/solid\s(.+)/,p=0,g=/[\s]+([+-]?(?:\d*)(?:\.\d*)?(?:[eE][+-]?\d+)?)/.source,m=new RegExp("vertex"+g+g+g,"g"),x=new RegExp("normal"+g+g+g,"g"),v=[],y=[],_=[],S=new M,T,b=0,w=0,E=0;for(;(T=h.exec(c))!==null;){w=E;let C=T[0],A=(T=d.exec(C))!==null?T[1]:"";for(_.push(A);(T=f.exec(C))!==null;){let le=0,te=0,R=T[0];for(;(T=x.exec(R))!==null;)S.x=parseFloat(T[1]),S.y=parseFloat(T[2]),S.z=parseFloat(T[3]),te++;for(;(T=m.exec(R))!==null;)v.push(parseFloat(T[1]),parseFloat(T[2]),parseFloat(T[3])),y.push(S.x,S.y,S.z),le++,E++;te!==1&&console.error("THREE.STLLoader: Something isn't right with the normal of face number "+p),le!==3&&console.error("THREE.STLLoader: Something isn't right with the vertices of face number "+p),p++}let K=w,$=E-w;u.userData.groupNames=_,u.addGroup(K,$,b),b++}return u.setAttribute("position",new Q(v,3)),u.setAttribute("normal",new Q(y,3)),u}function r(c){return typeof c!="string"?new TextDecoder().decode(c):c}function o(c){if(typeof c=="string"){let u=new Uint8Array(c.length);for(let h=0;h<c.length;h++)u[h]=c.charCodeAt(h)&255;return u.buffer||u}else return c}let a=o(e);return t(a)?i(a):s(r(e))}};var Ne=new L,Es=class extends de{constructor(e){super(e),this.propertyNameMapping={},this.customPropertyMapping={}}load(e,t,n,i){let s=this,r=new ve(this.manager);r.setPath(this.path),r.setResponseType("arraybuffer"),r.setRequestHeader(this.requestHeader),r.setWithCredentials(this.withCredentials),r.load(e,function(o){try{t(s.parse(o))}catch(a){i?i(a):console.error(a),s.manager.itemError(e)}},n,i)}setPropertyNameMapping(e){this.propertyNameMapping=e}setCustomPropertyNameMapping(e){this.customPropertyMapping=e}parse(e){function t(m,x=0){let v=/^ply([\s\S]*)end_header(\r\n|\r|\n)/,y="",_=v.exec(m);_!==null&&(y=_[1]);let S={comments:[],elements:[],headerLength:x,objInfo:""},T=y.split(/\r\n|\r|\n/),b;function w(E,C){let A={type:E[0]};return A.type==="list"?(A.name=E[3],A.countType=E[1],A.itemType=E[2]):A.name=E[1],A.name in C&&(A.name=C[A.name]),A}for(let E=0;E<T.length;E++){let C=T[E];if(C=C.trim(),C==="")continue;let A=C.split(/\s+/),K=A.shift();switch(C=A.join(" "),K){case"format":S.format=A[0],S.version=A[1];break;case"comment":S.comments.push(C);break;case"element":b!==void 0&&S.elements.push(b),b={},b.name=A[0],b.count=parseInt(A[1]),b.properties=[];break;case"property":b.properties.push(w(A,g.propertyNameMapping));break;case"obj_info":S.objInfo=C;break;default:console.log("unhandled",K,A)}}return b!==void 0&&S.elements.push(b),S}function n(m,x){switch(x){case"char":case"uchar":case"short":case"ushort":case"int":case"uint":case"int8":case"uint8":case"int16":case"uint16":case"int32":case"uint32":return parseInt(m);case"float":case"double":case"float32":case"float64":return parseFloat(m)}}function i(m,x){let v={};for(let y=0;y<m.length;y++){if(x.empty())return null;if(m[y].type==="list"){let _=[],S=n(x.next(),m[y].countType);for(let T=0;T<S;T++){if(x.empty())return null;_.push(n(x.next(),m[y].itemType))}v[m[y].name]=_}else v[m[y].name]=n(x.next(),m[y].type)}return v}function s(){let m={indices:[],vertices:[],normals:[],uvs:[],faceVertexUvs:[],colors:[],faceVertexColors:[]};for(let x of Object.keys(g.customPropertyMapping))m[x]=[];return m}function r(m){let x=m.map(y=>y.name);function v(y){for(let _=0,S=y.length;_<S;_++){let T=y[_];if(x.includes(T))return T}return null}return{attrX:v(["x","px","posx"])||"x",attrY:v(["y","py","posy"])||"y",attrZ:v(["z","pz","posz"])||"z",attrNX:v(["nx","normalx"]),attrNY:v(["ny","normaly"]),attrNZ:v(["nz","normalz"]),attrS:v(["s","u","texture_u","tx"]),attrT:v(["t","v","texture_v","ty"]),attrR:v(["red","diffuse_red","r","diffuse_r"]),attrG:v(["green","diffuse_green","g","diffuse_g"]),attrB:v(["blue","diffuse_blue","b","diffuse_b"])}}function o(m,x){let v=s(),y=/end_header\s+(\S[\s\S]*\S|\S)\s*$/,_,S;(S=y.exec(m))!==null?_=S[1].split(/\s+/):_=[];let T=new Xo(_);e:for(let b=0;b<x.elements.length;b++){let w=x.elements[b],E=r(w.properties);for(let C=0;C<w.count;C++){let A=i(w.properties,T);if(!A)break e;c(v,w.name,A,E)}}return a(v)}function a(m){let x=new me;m.indices.length>0&&x.setIndex(m.indices),x.setAttribute("position",new Q(m.vertices,3)),m.normals.length>0&&x.setAttribute("normal",new Q(m.normals,3)),m.uvs.length>0&&x.setAttribute("uv",new Q(m.uvs,2)),m.colors.length>0&&x.setAttribute("color",new Q(m.colors,3)),(m.faceVertexUvs.length>0||m.faceVertexColors.length>0)&&(x=x.toNonIndexed(),m.faceVertexUvs.length>0&&x.setAttribute("uv",new Q(m.faceVertexUvs,2)),m.faceVertexColors.length>0&&x.setAttribute("color",new Q(m.faceVertexColors,3)));for(let v of Object.keys(g.customPropertyMapping))m[v].length>0&&x.setAttribute(v,new Q(m[v],g.customPropertyMapping[v].length));return x.computeBoundingSphere(),x}function c(m,x,v,y){if(x==="vertex"){m.vertices.push(v[y.attrX],v[y.attrY],v[y.attrZ]),y.attrNX!==null&&y.attrNY!==null&&y.attrNZ!==null&&m.normals.push(v[y.attrNX],v[y.attrNY],v[y.attrNZ]),y.attrS!==null&&y.attrT!==null&&m.uvs.push(v[y.attrS],v[y.attrT]),y.attrR!==null&&y.attrG!==null&&y.attrB!==null&&(Ne.setRGB(v[y.attrR]/255,v[y.attrG]/255,v[y.attrB]/255,O),m.colors.push(Ne.r,Ne.g,Ne.b));for(let _ of Object.keys(g.customPropertyMapping))for(let S of g.customPropertyMapping[_])m[_].push(v[S])}else if(x==="face"){let _=v.vertex_indices||v.vertex_index,S=v.texcoord;_.length===3?(m.indices.push(_[0],_[1],_[2]),S&&S.length===6&&(m.faceVertexUvs.push(S[0],S[1]),m.faceVertexUvs.push(S[2],S[3]),m.faceVertexUvs.push(S[4],S[5]))):_.length===4&&(m.indices.push(_[0],_[1],_[3]),m.indices.push(_[1],_[2],_[3])),y.attrR!==null&&y.attrG!==null&&y.attrB!==null&&(Ne.setRGB(v[y.attrR]/255,v[y.attrG]/255,v[y.attrB]/255,O),m.faceVertexColors.push(Ne.r,Ne.g,Ne.b),m.faceVertexColors.push(Ne.r,Ne.g,Ne.b),m.faceVertexColors.push(Ne.r,Ne.g,Ne.b))}}function u(m,x){let v={},y=0;for(let _=0;_<x.length;_++){let S=x[_],T=S.valueReader;if(S.type==="list"){let b=[],w=S.countReader.read(m+y);y+=S.countReader.size;for(let E=0;E<w;E++)b.push(T.read(m+y)),y+=T.size;v[S.name]=b}else v[S.name]=T.read(m+y),y+=T.size}return[v,y]}function h(m,x,v){function y(_,S,T){switch(S){case"int8":case"char":return{read:b=>_.getInt8(b),size:1};case"uint8":case"uchar":return{read:b=>_.getUint8(b),size:1};case"int16":case"short":return{read:b=>_.getInt16(b,T),size:2};case"uint16":case"ushort":return{read:b=>_.getUint16(b,T),size:2};case"int32":case"int":return{read:b=>_.getInt32(b,T),size:4};case"uint32":case"uint":return{read:b=>_.getUint32(b,T),size:4};case"float32":case"float":return{read:b=>_.getFloat32(b,T),size:4};case"float64":case"double":return{read:b=>_.getFloat64(b,T),size:8}}}for(let _=0,S=m.length;_<S;_++){let T=m[_];T.type==="list"?(T.countReader=y(x,T.countType,v),T.valueReader=y(x,T.itemType,v)):T.valueReader=y(x,T.type,v)}}function f(m,x){let v=s(),y=x.format==="binary_little_endian",_=new DataView(m,x.headerLength),S,T=0;for(let b=0;b<x.elements.length;b++){let w=x.elements[b],E=w.properties,C=r(E);h(E,_,y);for(let A=0;A<w.count;A++){S=u(T,E),T+=S[1];let K=S[0];c(v,w.name,K,C)}}return a(v)}function d(m){let x=0,v=!0,y="",_=[],S=new TextDecoder().decode(m.subarray(0,5)),T=/^ply\r\n/.test(S);do{let b=String.fromCharCode(m[x++]);b!==`
`&&b!=="\r"?y+=b:(y==="end_header"&&(v=!1),y!==""&&(_.push(y),y=""))}while(v&&x<m.length);return T===!0&&x++,{headerText:_.join("\r")+"\r",headerLength:x}}let p,g=this;if(e instanceof ArrayBuffer){let m=new Uint8Array(e),{headerText:x,headerLength:v}=d(m),y=t(x,v);if(y.format==="ascii"){let _=new TextDecoder().decode(m);p=o(_,y)}else p=f(e,y)}else p=o(e,t(e));return p}},Xo=class{constructor(e){this.arr=e,this.i=0}empty(){return this.i>=this.arr.length}next(){return this.arr[this.i++]}};var Rs=class extends li{constructor(e){super(e)}parse(e){function t(R){switch(R.image_type){case f:case g:if(R.colormap_length>256||R.colormap_size!==24||R.colormap_type!==1)throw new Error("THREE.TGALoader: Invalid type colormap data for indexed type.");break;case d:case p:case m:case x:if(R.colormap_type)throw new Error("THREE.TGALoader: Invalid type colormap data for colormap type.");break;case h:throw new Error("THREE.TGALoader: No data.");default:throw new Error("THREE.TGALoader: Invalid type "+R.image_type)}if(R.width<=0||R.height<=0)throw new Error("THREE.TGALoader: Invalid image size.");if(R.pixel_size!==8&&R.pixel_size!==16&&R.pixel_size!==24&&R.pixel_size!==32)throw new Error("THREE.TGALoader: Invalid pixel size "+R.pixel_size)}function n(R,V,z,H,ae){let j,ne,B=z.pixel_size>>3,F=z.width*z.height*B;if(V&&(ne=ae.subarray(H,H+=z.colormap_length*(z.colormap_size>>3))),R){j=new Uint8Array(F);let U,P,N,ce=0,Fe=new Uint8Array(B);for(;ce<F;)if(U=ae[H++],P=(U&127)+1,U&128){for(N=0;N<B;++N)Fe[N]=ae[H++];for(N=0;N<P;++N)j.set(Fe,ce+N*B);ce+=B*P}else{for(P*=B,N=0;N<P;++N)j[ce+N]=ae[H++];ce+=P}}else j=ae.subarray(H,H+=V?z.width*z.height:F);return{pixel_data:j,palettes:ne}}function i(R,V,z,H,ae,j,ne,B,F){let U=F,P,N=0,ce,Fe,un=C.width;for(Fe=V;Fe!==H;Fe+=z)for(ce=ae;ce!==ne;ce+=j,N++)P=B[N],R[(ce+un*Fe)*4+3]=255,R[(ce+un*Fe)*4+2]=U[P*3+0],R[(ce+un*Fe)*4+1]=U[P*3+1],R[(ce+un*Fe)*4+0]=U[P*3+2];return R}function s(R,V,z,H,ae,j,ne,B){let F,U=0,P,N,ce=C.width;for(N=V;N!==H;N+=z)for(P=ae;P!==ne;P+=j,U+=2)F=B[U+0]+(B[U+1]<<8),R[(P+ce*N)*4+0]=(F&31744)>>7,R[(P+ce*N)*4+1]=(F&992)>>2,R[(P+ce*N)*4+2]=(F&31)<<3,R[(P+ce*N)*4+3]=F&32768?0:255;return R}function r(R,V,z,H,ae,j,ne,B){let F=0,U,P,N=C.width;for(P=V;P!==H;P+=z)for(U=ae;U!==ne;U+=j,F+=3)R[(U+N*P)*4+3]=255,R[(U+N*P)*4+2]=B[F+0],R[(U+N*P)*4+1]=B[F+1],R[(U+N*P)*4+0]=B[F+2];return R}function o(R,V,z,H,ae,j,ne,B){let F=0,U,P,N=C.width;for(P=V;P!==H;P+=z)for(U=ae;U!==ne;U+=j,F+=4)R[(U+N*P)*4+2]=B[F+0],R[(U+N*P)*4+1]=B[F+1],R[(U+N*P)*4+0]=B[F+2],R[(U+N*P)*4+3]=B[F+3];return R}function a(R,V,z,H,ae,j,ne,B){let F,U=0,P,N,ce=C.width;for(N=V;N!==H;N+=z)for(P=ae;P!==ne;P+=j,U++)F=B[U],R[(P+ce*N)*4+0]=F,R[(P+ce*N)*4+1]=F,R[(P+ce*N)*4+2]=F,R[(P+ce*N)*4+3]=255;return R}function c(R,V,z,H,ae,j,ne,B){let F=0,U,P,N=C.width;for(P=V;P!==H;P+=z)for(U=ae;U!==ne;U+=j,F+=2)R[(U+N*P)*4+0]=B[F+0],R[(U+N*P)*4+1]=B[F+0],R[(U+N*P)*4+2]=B[F+0],R[(U+N*P)*4+3]=B[F+1];return R}function u(R,V,z,H,ae){let j,ne,B,F,U,P;switch((C.flags&v)>>y){default:case T:j=0,B=1,U=V,ne=0,F=1,P=z;break;case _:j=0,B=1,U=V,ne=z-1,F=-1,P=-1;break;case b:j=V-1,B=-1,U=-1,ne=0,F=1,P=z;break;case S:j=V-1,B=-1,U=-1,ne=z-1,F=-1,P=-1;break}if($)switch(C.pixel_size){case 8:a(R,ne,F,P,j,B,U,H);break;case 16:c(R,ne,F,P,j,B,U,H);break;default:throw new Error("THREE.TGALoader: Format not supported.")}else switch(C.pixel_size){case 8:i(R,ne,F,P,j,B,U,H,ae);break;case 16:s(R,ne,F,P,j,B,U,H);break;case 24:r(R,ne,F,P,j,B,U,H);break;case 32:o(R,ne,F,P,j,B,U,H);break;default:throw new Error("THREE.TGALoader: Format not supported.")}return R}let h=0,f=1,d=2,p=3,g=9,m=10,x=11,v=48,y=4,_=0,S=1,T=2,b=3;if(e.length<19)throw new Error("THREE.TGALoader: Not enough data to contain header.");let w=0,E=new Uint8Array(e),C={id_length:E[w++],colormap_type:E[w++],image_type:E[w++],colormap_index:E[w++]|E[w++]<<8,colormap_length:E[w++]|E[w++]<<8,colormap_size:E[w++],origin:[E[w++]|E[w++]<<8,E[w++]|E[w++]<<8],width:E[w++]|E[w++]<<8,height:E[w++]|E[w++]<<8,pixel_size:E[w++],flags:E[w++]};if(t(C),C.id_length+w>e.length)throw new Error("THREE.TGALoader: No data.");w+=C.id_length;let A=!1,K=!1,$=!1;switch(C.image_type){case g:A=!0,K=!0;break;case f:K=!0;break;case m:A=!0;break;case d:break;case x:A=!0,$=!0;break;case p:$=!0;break}let le=new Uint8Array(C.width*C.height*4),te=n(A,K,C,w,E);return u(le,C.width,C.height,te.pixel_data,te.palettes),{data:le,width:C.width,height:C.height,flipY:!0,generateMipmaps:!0,minFilter:ht}}};var Is=["glb","gltf","fbx","obj","stl","ply"],Ps=l=>l.name.split(".").pop().toLowerCase();function Cs(l){let e=[];for(let t of decodeURIComponent(l).replace(/\\/g,"/").split("/"))t===".."?e.pop():t&&t!=="."&&e.push(t);return e.join("/")}async function ud(l,e=[l]){if(!Is.includes(Ps(l)))throw new Error("\u652F\u6301 GLB\u3001glTF\u3001FBX\u3001OBJ\u3001STL\u3001PLY");if(e.length>128||e.reduce((g,m)=>g+m.size,0)>256*1048576||l.size>100*1048576)throw new Error("\u6A21\u578B\u6700\u5927 100 MiB\uFF0C\u5355\u6279\u6700\u591A 128 \u4E2A\u6587\u4EF6\u3001256 MiB");if(Ps(l)==="glb")return l;let t=[],n=new Map,i=new Map,s=new Un;s.addHandler(/\.tga$/i,new Rs(s));for(let g of e){let m=Cs(g.webkitRelativePath||g.name);if(n.has(m))throw new Error("\u5B58\u5728\u540C\u540D\u6587\u4EF6\uFF0C\u8BF7\u5206\u6279\u5BFC\u5165\uFF0C\u6216\u901A\u8FC7\u6587\u4EF6\u5939\u4FDD\u7559\u8DEF\u5F84\uFF1A"+m);n.set(m,g);let x=m.split("/").pop();i.set(x,i.has(x)?null:g)}let r=0,o,a,c=new Promise(g=>o=g),u=s.itemStart.bind(s),h=s.itemEnd.bind(s);s.itemStart=g=>{r++,u(g)},s.itemEnd=g=>{h(g),--r||o()},s.onError=g=>{a=new Error("\u65E0\u6CD5\u8BFB\u53D6\u6A21\u578B\u4F9D\u8D56\uFF1A"+g)},s.setURLModifier(g=>{if(/^(data:|blob:)/i.test(g))return g;if(/^[a-z][a-z\d+.-]*:|^\/\//i.test(g))throw new Error("\u6A21\u578B\u4E0D\u80FD\u8BFB\u53D6\u7F51\u7EDC\u8D44\u6E90\uFF0C\u8BF7\u5C06\u8D34\u56FE\u4E0E\u6A21\u578B\u4E00\u8D77\u5BFC\u5165");let m=Cs(g),x=n.get(m)||i.get(m.split("/").pop());if(!x)throw new Error("\u7F3A\u5C11\u6216\u5B58\u5728\u540C\u540D\u4F9D\u8D56\uFF0C\u8BF7\u5C06\u6587\u4EF6\u4E00\u8D77\u5BFC\u5165\uFF1A"+m);let v=URL.createObjectURL(x);return t.push(v),v});let f,d=[],p;try{let g=await l.arrayBuffer(),m=Ps(l),x=Cs(l.webkitRelativePath||l.name).split("/").slice(0,-1).join("/"),v=x?x+"/":"";if(m==="gltf"){let _=await new gs(s).parseAsync(new TextDecoder().decode(g),v);f=_.scene,d=_.animations}else if(m==="fbx")f=new vs(s).parse(g,v),d=f.animations||[];else if(m==="obj"){let _=new TextDecoder().decode(g),S=[];for(let b of _.matchAll(/^\s*mtllib\s+(.+)$/gm)){let w=Cs(v+b[1].trim()),E=n.get(w)||i.get(w.split("/").pop());if(!E)throw new Error("\u7F3A\u5C11\u6750\u8D28\u6587\u4EF6\uFF0C\u8BF7\u4E00\u8D77\u5BFC\u5165\uFF1A"+w);let C=new ws(s).parse(await E.text(),w.includes("/")?w.slice(0,w.lastIndexOf("/")+1):"");C.preload(),S.push(C)}let T=new bs(s);S.length&&T.setMaterials({create:b=>S.find(w=>Object.hasOwn(w.materialsInfo,b))?.create(b)||new lt}),f=T.parse(_)}else{if(m==="ply"&&!/element\s+face\s+[1-9]\d*/.test(new TextDecoder().decode(g.slice(0,16384))))throw new Error("PLY \u70B9\u4E91\u6682\u4E0D\u652F\u6301\uFF0C\u8BF7\u5BFC\u51FA\u542B\u4E09\u89D2\u9762\u7684\u7F51\u683C\u6A21\u578B");let _=m==="stl"?new As().parse(g):new Es().parse(g);_.getAttribute("normal")||_.computeVertexNormals(),f=new Le,f.add(new we(_,new lt({color:new L(12241112),vertexColors:!!_.getAttribute("color")})))}if(r&&await Promise.race([c,new Promise((_,S)=>p=setTimeout(()=>S(new Error("\u6A21\u578B\u8D34\u56FE\u8BFB\u53D6\u8D85\u65F6")),3e4))]),a)throw a;let y=await new hn().parseAsync(f,{binary:!0,animations:d,onlyVisible:!1});if(y.byteLength>100*1048576)throw new Error("\u8F6C\u6362\u540E\u7684\u6A21\u578B\u8D85\u8FC7 100 MiB\uFF0C\u8BF7\u5148\u7B80\u5316\u6A21\u578B\u6216\u8D34\u56FE");return new File([y],l.name.replace(/\.[^.]+$/,".glb"),{type:"model/gltf-binary"})}finally{clearTimeout(p),t.forEach(g=>URL.revokeObjectURL(g)),f?.traverse(g=>{g.geometry?.dispose();for(let m of[].concat(g.material||[])){for(let x of Object.values(m))x?.isTexture&&x.dispose();m.dispose()}})}}typeof window<"u"&&(window.GameModelImport={extensions:Is,accept:Is.map(l=>"."+l).join(","),isModel:l=>Is.includes(Ps(l)),convert:ud});})();
