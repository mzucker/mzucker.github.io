'use strict';

const DEFAULT_DT = 0.1;

function ticks(seconds, dt) {
  return Math.round(seconds / dt);
}

let value_re = new RegExp('(\\w+)\\.(\\w+)(\\.(\\w+))?');

let dynamic_values = {};
let dynamic_value_subscribers = {};

let normrnd_spare = undefined;

let default_kalman_opts = {
  pos_process_stddev: 0.1,
  vel_process_stddev: 0.01,
  pos_meas_stddev: 0.1,
  vel_meas_stddev: 0.01,
  pos_init_stddev: 0.01,
  vel_init_stddev: 0.001
};

function normrnd() {

  if (normrnd_spare != undefined) {
    
    const rval = normrnd_spare;
    normrnd_spare = undefined;
    return rval;
    
  } else {

    let u, v, s;

    while (true) {

      u = Math.random() * 2 - 1;
      v = Math.random() * 2 - 1;
      s = u*u + v*v;

      if (s > 0 && s < 1) {
        break;
      }

    }

    s = Math.sqrt(-2*Math.log(s) / s);
    normrnd_spare = v * s;
    return u * s;

  }
  
  
}

function normrnd_vec(len) {

  let rval = [];
  
  for (let i=0; i<len; ++i) {
    rval.push(normrnd());
  }

  return Matrix(rval);
  
}

function matrix_sqrt(A) {
  if (A == undefined) { return A; }
  let usv = create_clone(A).SVD;
  for (let i=0; i<usv[1].rows; ++i) {
    usv[1][i] = Math.sqrt(usv[1][i]);
  }
  return Matrix.mul(usv[2], Matrix.mul(Matrix.diag(usv[1]), usv[2].t));
}

function shape_noise(M) {
  return Matrix.mul(M, normrnd_vec(M.rows));
}

function variance_from_stddevs(stddevs) {
  let variances = stddevs.map(x => x*x);
  return Matrix.diag(variances);
}

function create_system(opts) {

  const dt = use_if(opts.dt, DEFAULT_DT);

  let default_ticks_per_plot = Math.round(DEFAULT_DT / dt);
  if (default_ticks_per_plot <= 0) {
    default_ticks_per_plot = 1;
  }
  
  const ticks_per_plot = use_if(opts.ticks_per_plot, default_ticks_per_plot);

  let Adata = [[1, dt], [0, 1]];
  let Bdata = [0, dt];

  if (opts.stiffness) {
    Adata[1][0] -= dt*opts.stiffness;
  }
  
  if (opts.damping) {
    Adata[1][1] -= dt*opts.damping;
  }

  if (opts.is_affine) {
    
    Adata[0].push(0);
    Adata[1].push(0);
    Adata.push([0, 0, 1]);

    Bdata.push(0);
    
  }

  let system = {
    A: Matrix(Adata),
    B: Matrix(Bdata),
    dt,
    ticks_per_plot,
  };

  if (opts.pos_process_stddev &&
      opts.vel_process_stddev &&
      (opts.pos_meas_stddev || opts.vel_meas_stddev)) {

    let process_stddevs = [
      opts.pos_process_stddev,
      opts.vel_process_stddev
    ];

    if (opts.is_affine) {
      process_stddevs.push(0);
    }

    let W = variance_from_stddevs(process_stddevs);

    let Cdata = [];
    let meas_stddevs = [];

    if (opts.pos_meas_stddev) {
      let row = [1, 0]
      if (opts.is_affine) { row.push(0); }
      Cdata.push(row);
      meas_stddevs.push(opts.pos_meas_stddev);
    }

    if (opts.vel_meas_stddev) {
      let row = [0, 1];
      if (opts.is_affine) { row.push(0); }
      Cdata.push(row);
      meas_stddevs.push(opts.vel_meas_stddev);
    }

    let V = variance_from_stddevs(meas_stddevs);
    let C = Matrix(Cdata);

    Object.assign(system, { W, V, C });
    
  }

  return system;
  
}

function use_if(a, b) {
  return a == undefined ? b : a;
}

function create_init_state(pos, vel, system, opts) {

  let x = Matrix([pos, vel]);
  let init_state = { x };

  if (opts.pos_process_stddev &&
      opts.vel_process_stddev &&
      (opts.pos_meas_stddev || opts.vel_meas_stddev)) {

    let pos_init_stddev = use_if(opts.pos_init_stddev, opts.pos_process_stddev);
    let vel_init_stddev = use_if(opts.vel_init_stddev, opts.vel_process_stddev);

    let mu = create_clone(x);

    let P = variance_from_stddevs([pos_init_stddev, vel_init_stddev]);

    Object.assign(init_state, {mu, P});

  }

  return init_state;
  
}

function noisy_mass(pos_process_stddev,
                    vel_process_stddev,
                    pos_meas_stddev,
                    vel_meas_stddev,
                    is_affine) {

  let process_stddevs = [ pos_process_stddev, vel_process_stddev ];
  let meas_stddevs = [];

  let Cdata = [];

  if (is_affine) {
    process_stddevs.push(0.0);
  }

  let W = variance_from_stddevs(process_stddevs);
  let V = variance_from_stddevs(meas_stddevs);
  let C = Matrix(Cdata);

  return Object.assign({ W, V, C }, deterministic_mass(is_affine));
  
}


//////////////////////////////////////////////////////////////////////

// init_state is an object with fields x (and mu and P if desired to run a KF)
//
// system has fields:
//
//   A and B,     no matter what
//   C, V, and W  if a kalman filter is desired
//   K            if LQR control should be run (will be run on state.mu if it exists otherwise state.x)
//   controller   a callback function(time, system, state) => control
//
// it returns an object with fields:
//
//   pos_data
//   pos_labels
//
//   vel_data
//   vel_labels
//
//   force_data
//   force_labels
//
//   L_final
//   state_final
//

// works as sqrt for symmetric positive semidefinite matrices

function simulate(system, state, tfinal) {

  state = Object.assign({}, state);

  if (state.mu == undefined) {
    state.mu = state.x;
  }
  
  system = Object.assign({}, system);

  if (tfinal == undefined) { tfinal = 10.0; }
  tfinal += 0.5*system.dt;

  const A = system.A;
  const B = system.B;
  
  const C = system.C;
  const V = system.V;
  const W = system.W;

  const nstate = state.x.rows;
  const vv = nstate + 1;
  
  const Vsqrt = matrix_sqrt(V);
  const Wsqrt = matrix_sqrt(W);

  const is_kalman = (C != undefined &&
                     V != undefined &&
                     W != undefined);

  const state_input = (is_kalman ? 'mu' : 'x');

  const linear_dynamics = function(x, u) {
    return Matrix.add(Matrix.mul(A, x),
                      Matrix.mul(B, u));
  }
  
  const noisy_linear_dynamics = function(x, u) {
    return Matrix.add(linear_dynamics(x, u), shape_noise(Vsqrt));
  }

  const sample_measurement = function(x) {
    return Matrix.add(Matrix.mul(C, x), shape_noise(Wsqrt));
  }
  
  const update_P_motion = function(P) {
    return Matrix.add(Matrix.mul(A, Matrix.mul(P, A.t)), V);
  }

  const I = Matrix.identity(A.rows);

  const S_measurement = function(P) {
    return Matrix.add(Matrix.mul(C, Matrix.mul(P, C.t)), W);
  }

  const L_measurement = function(P, S) {
    return Matrix.mul(Matrix.mul(P, C.t), Matrix.invertLU(S));
  }

  const update_mu_measurement = function(x, L, z) {
    let y = Matrix.add(z, Matrix.mul(-1, Matrix.mul(C, x)));
    return Matrix.add(x, Matrix.mul(L, y));
  }

  const update_P_measurement = function(P, L) {
    return Matrix.mul(Matrix.add(I, Matrix.mul(-1, Matrix.mul(L, C))), P);
  }
  
  // deal with preset control gains
  if ('K' in system) {
    
    const K = system.K;
    
    system.controller = function(time, system, state) {
      return Matrix.mul(-1, Matrix.mul(K, state[state_input]));
    };
    
  }

  let pos_data = [];
  let vel_data = [];
  let force_data = [];

  const pos_labels = (is_kalman ?
                      ['time', 'true pos', 'est. pos'] :
                      ['time', 'pos']);

  const pos_colors = (is_kalman ? ['#00c', '#b0d'] : ['#00c']);

  const vel_labels = (is_kalman ?
                      ['time', 'true vel', 'est. vel'] :
                      ['time', 'vel']);

  const vel_colors = (is_kalman ? ['#080', '#0bb'] : ['#080']);

  const force_labels = ['time', 'force'];

  const force_colors = ['#c00'];

  let L;


  for (let t=0.0, tick=0; t<tfinal; t+=system.dt, tick+=1) {

    const plot_this_tick = (tick % system.ticks_per_plot == 0);

    let u = system.controller(t, system, state);

    if (plot_this_tick) {
      if (typeof u == 'number') {
        force_data.push([t, u]);
      } else {
        force_data.push([t, u[0]]);
      }
    }
    
    if (is_kalman) {

      state.x = noisy_linear_dynamics(state.x, u);
      state.mu = linear_dynamics(state.mu, u);
      state.P = update_P_motion(state.P);

      let z = sample_measurement(state.x);

      let S = S_measurement(state.P);
      L = L_measurement(state.P, S);

      state.mu = update_mu_measurement(state.mu, L, z);
      state.P = update_P_measurement(state.P, L);

      if (plot_this_tick) {
        pos_data.push([t, [state.x[0], 0], [state.mu[0], Math.sqrt(state.P[0])]])
        vel_data.push([t, [state.x[1], 0], [state.mu[1], Math.sqrt(state.P[vv])]])
      }

    } else {

      state.x = linear_dynamics(state.x, u);

      if (plot_this_tick) {
        pos_data.push([t, state.x[0]]);
        vel_data.push([t, state.x[1]]);
      }
      
    }
    
  }

  return { pos_data, pos_labels, pos_colors, 
           vel_data, vel_labels, vel_colors, 
           force_data, force_labels, force_colors,
           L_final: L,
           errorBars: is_kalman,
           state_final: state };
  
}

//////////////////////////////////////////////////////////////////////

function dynamic_value_changed(name, value, source, previewing) {

  dynamic_values[name] = value;

  if (name in dynamic_value_subscribers) {
    dynamic_value_subscribers[name].forEach(function(fp) {
      const func = fp[0], allow_previewing = fp[1];
      if (allow_previewing || !previewing) {
        func(name, value, source, previewing);
      }
    });
  }
  
};

function dynamic_value_subscribe(name, func, allow_previewing) {

  if (!(name in dynamic_value_subscribers)) {
    dynamic_value_subscribers[name] = new Array();
  }

  if (allow_previewing == undefined) {
    allow_previewing = true;
  }

  dynamic_value_subscribers[name].push([func, allow_previewing])

}

function vstack(arrays) {

  let rval = [];

  for (let i=0; i<arrays[0].length; ++i) {
    let item = [];
    for (let j=0; j<arrays.length; ++j) {
      item.push(arrays[j][i]);
    }
    rval.push(item);
  }

  return rval;

}

function graph_underlay(ctx, area, dygraph) {
  ctx.strokeStyle = 'black';
  ctx.lineWidth = 2;
  ctx.strokeRect(area.x, area.y, area.w, area.h);
}

function format_value(num_or_millis, opts, series_name, dygraph, row, col) {
  if (series_name == 'time') {
    return 't=' + num_or_millis.toFixed(1) + ' s';
  } else {
    let rval = num_or_millis.toFixed(3);
    if (opts('errorBars')) {
      const values = dygraph.getValue(row, col);
      if (values.length == 2 && values[1]) {
        rval += ' ± ' + (opts('sigma') * values[1]).toFixed(3);
      }
    }
    return rval;
  }
}

function graph_one(div, data, opts_obj) {

  let opts = {
    legend: 'always',
    underlayCallback: graph_underlay,
    valueFormatter: format_value,
  }

  opts = Object.assign(opts, opts_obj);

  if (opts.axes == undefined) { opts.axes = {}; }
  if (opts.axes.y == undefined) { opts.axes.y = {}; }
  if (opts.axes.x == undefined) { opts.axes.x = {}; }

  opts.axes.y.pixelsPerLabel = 18;
  opts.axes.x.pixelsPerLabel = 50;

  return new Dygraph(div, data, opts);
  
}

//////////////////////////////////////////////////////////////////////

function simulator_plots(setup, div, title, opts) {

  let titleDiv = document.createElement('div'),
      div1 = document.createElement('div'),
      div2 = document.createElement('div'),
      div3 = undefined,
      xlabelDiv = document.createElement('div');

  titleDiv.classList.add('dygraph-title');
  div1.classList.add('narrowplot');
  div2.classList.add('narrowplot');
  xlabelDiv.classList.add('dygraph-xlabel');

  titleDiv.innerHTML = title;
  xlabelDiv.innerHTML = 'time (s)';

  div.appendChild(titleDiv);
  div.appendChild(div1);
  div.appendChild(div2);

  if (opts.show_force == undefined || opts.show_force) {
    div3 = document.createElement('div'),
    div3.classList.add('narrowplot');
    div.appendChild(div3);
  }
  
  div.appendChild(xlabelDiv);

  let get_data = function() {

    let s = (typeof setup == 'function' ? setup() : setup);

    if (opts.seed) {
      Math.seedrandom(opts.seed);
    }
    
    let results = simulate(s.system, s.state);

    return results;
    
  };

  let results = get_data();

  let pos_axes = { x: { axisLabelFormatter: (x => '') } };

  let vel_axes = {};

  if (opts.show_force == undefined || opts.show_force) {
    vel_axes = pos_axes;
  }
  

  let pos_graph = graph_one(div1, results.pos_data, 
                            { ylabel: 'pos',
                              labels: results.pos_labels,
                              colors: results.pos_colors,
                              errorBars: results.errorBars,
                              axes: pos_axes
                            });
  
  let vel_graph = graph_one(div2, results.vel_data, 
                            { ylabel: 'vel',
                              labels: results.vel_labels,
                              colors: results.vel_colors,
                              errorBars: results.errorBars,
                              axes: vel_axes
                            });

  let graphs = [pos_graph, vel_graph];

  let force_graph = undefined;

  if (opts.show_force == undefined || opts.show_force) {

    force_graph = graph_one(div3, results.force_data, 
                            { ylabel: 'force',
                              labels: results.force_labels,
                              colors: results.force_colors });
    
    graphs.push(force_graph);

  }

  Dygraph.synchronize(graphs, {range: false});

  let replot_all = function() {

    const results = get_data();

    pos_graph.updateOptions({file: results.pos_data});
    vel_graph.updateOptions({file: results.vel_data});

    if (opts.show_force == undefined || opts.show_force) {
      force_graph.updateOptions({file: results.force_data});
    }

    pos_graph.resetZoom();
    
  }

  if (opts.dynamic_values != undefined) {
    opts.dynamic_values.forEach(function(name) {
      dynamic_value_subscribe(name, replot_all, false);
    });
  }

  return { pos_graph, vel_graph, force_graph, replot_all };

}

//////////////////////////////////////////////////////////////////////
