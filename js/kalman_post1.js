$(document).ready(function() {

  console.log('what up');

  $('.linked_range').each(function(index, element) {

    const id = element.id;
    const match = id.match(value_re);

    if (match == null) { return; }

    const name = match[1];

    let sel = $(element);

    sel.on('change input', function(event) {

      const value = parseFloat($(event.target).val());
      const previewing = (event.type == 'input');

      dynamic_value_changed(name, value, event.target, previewing);
    
    });

    dynamic_value_subscribe(name, function(name, value, source, previewing) {
      if (source != element) {
        sel.val(value);
      }
    });

  });

  $('.linked_value').each(function(index, element) {

    const id = element.id;
    const match = id.match(value_re);

    if (match == null) { return; }

    const name = match[1];

    dynamic_value_subscribe(name, function(name, value) {
      element.innerHTML = value.toFixed(1);
    });
    
  });

  $('.linked_range').trigger('change');

  simulator_plots(

    function() {

      let opts = {};

      let system = create_system(opts);
      
      const first_time = dynamic_values['first_time'];
      let first_duration = dynamic_values['first_duration'];

      const start_time = first_time - 0.5 * system.dt;
      const end_time = start_time + first_duration + system.dt;
      
      system.controller = function(time, system, state) {
        if (time >= start_time && time <= end_time) {
          return 1.0;
        } else {
          return 0.0;
        }
      }

      let state = create_init_state(0, 0.1, system, opts);

      return { system, state };
      
    },
    
    document.getElementById('firstplot'),
    'Ice block wheeeee',
    { dynamic_values: ['first_time', 'first_duration'] });

  simulator_plots(

    function() {
      
      let opts = {};
      
      let system = create_system(opts);

      let beta = dynamic_values['beta'];

      system.A[3] -= beta * DEFAULT_DT;
      
      system.controller = function(time, system, state) {
        return 0.0;
      }

      let state = create_init_state(0, 1.0, system, opts);

      return { system, state };
      

    },

    document.getElementById('secondplot'),
    'Ice block with friction',
    { dynamic_values: ['beta'], show_force: false });

  simulator_plots(

    function() {

      const dt = 0.001;
      const ticks_per_plot = 10;
      
      let opts = { dt, ticks_per_plot };
      
      let system = create_system(opts);

      let alpha = dynamic_values['alpha'];

      system.A[2] -= alpha * dt;
      
      system.controller = function(time, system, state) {
        return 0.0;
      }

      let state = create_init_state(1.0, 0.0, system, opts);

      return { system, state };
      

    },

    document.getElementById('thirdplot'),
    'Springy ice block',
    { dynamic_values: ['alpha'], show_force: false });

  simulator_plots(

    function() {

      const dt = 0.001;
      const ticks_per_plot = 10;
      
      let opts = { dt, ticks_per_plot };
      
      let system = create_system(opts);

      let beta = dynamic_values['beta2'];
      let alpha = dynamic_values['alpha2'];

      system.A[3] -= beta * dt; 
      system.A[2] -= alpha * dt;

      const last_time = dynamic_values['last_time'];
      let last_duration = dynamic_values['last_duration'];
      
      const start_time = last_time - 0.5 * system.dt;
      const end_time = start_time + last_duration + system.dt;
      
      system.controller = function(time, system, state) {
        if (time >= start_time && time <= end_time) {
          return 1.0;
        } else {
          return 0.0;
        }
      }

      let state = create_init_state(0.5, 0.1, system, opts);

      return { system, state };
      

    },

    document.getElementById('lastplot'),
    'All of the things!',
    { dynamic_values: ['alpha2', 'beta2', 'last_time', 'last_duration' ] });
  
});

