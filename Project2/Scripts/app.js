/// <reference path="jquery-2.2.2.min.js" />
/// <reference path="graphlib.js" />

var app;
$(function () {
    "use strict";

    app = new function Project2() {
        // vars
        var g = new graphlib.Graph();
        var cell_count = 0;
        var starting_nodes = [], ending_nodes = [];
        var visited = {};
        var current_path = [];
        var all_paths = [];
        var output_pins = [];
        var output_ports = [];
        var input_net_ids = {};
        var output_net_ids = {};
        var input_net_ids_node_names = {};
        var output_net_ids_node_names = {};
        var flipflop_outputs = [];
        var flipflop_inputs = [];

        // the app variable cannot be used until the function has 
        // completely executed. since calling "this" inside
        // another function has a different meaning, we just define
        // a new variable to use instead, which always points to this instance.
        var appInstance = this;

        // an array which holds the data that links the DOM elements
        // with the variable names; for example, if a DOM input["file"]
        // element is called "jsonInput", and we want to load the contents
        // of the file in `app.result`, we would define it in the as an object
        // in array as: { selector: "jsonInput", varName: "result" }.
        // Then, when the user chooses the .json file, the parsed json can be accessed
        // at `app.result`.
        var jsonBrowseButtons = {
            "library": {
                selector: "libraryInput",
                onLoaded: onLibraryLoaded
            },
            "netlist": {
                selector: "netListInput",
                onLoaded: onNetListLoaded
            },
            "netcapacitance": {
                selector: "netCapacitance"
            }
        };

        function nop(def) {
            return function () {
                return def;
            }
        }

        (function handleBrowseButtons(jsonBrowseButtons, onAllLoadedFn) {
            // how many files have been loaded so far
            var loadedCount = 0;

            // we need to go through each element and add a change event handler,
            // so when the user chooses an item, the json file gets loaded and manipulated.
            for (var varName in jsonBrowseButtons) {
                // we need a closure, as `varName` is replaced with every loop,
                // and since item is refered to in the inner annoynous function
                // (as the callback function), the function needs to "own" the item.
                (function (varName) {
                    var item = jsonBrowseButtons[varName];
                    item.loaded = false;

                    // register the callback to call the `function(event)` every time
                    // the file browser is changed; i.e. when the user chooses a JSON file.
                    $(document).on("change", "#" + item.selector, function (event) {
                        // "this" points to the current input element. we pass it to the function,
                        // and read the contents of the file, parse it, and pass it as a callback.
                        readLocalJSON(this, function (value) {
                            // get the jQuery element
                            var $this = $(this);

                            // app.{item.varName}
                            appInstance[varName] = value;

                            // if the function returns false, then something went wrong in the parsing
                            // and we revert changes. Perhaps the file that was inputted by the user
                            // was not the one that we expected.
                            // 
                            // nop() is a function that returns a function which does nothing but return
                            // the value passed to nop. so var ret1 = nop(1); ret1() will always return 1.
                            if ((item.onLoaded || nop(!!value))(value) === false || !value) {
                                // rollback
                                delete appInstance[varName];
                            } else {
                                // manipulate DOM: hide the input label,
                                // and the browse button. Add a success message.
                                $this.prev("label").hide();
                                $this.hide();
                                $("<label></label>")
                                    .html($this.val() + " has been loaded!")
                                    .insertBefore($this);

                                // set the item to loaded
                                item.loaded = true;

                                // increase the items loaded count
                                ++loadedCount;
                            }

                            // callback function when all items have been loaded.
                            if (onAllLoadedFn && loadedCount === Object.keys(jsonBrowseButtons).length) {
                                onAllLoadedFn();
                            }
                        });
                    });
                })(varName);
            }
        })(jsonBrowseButtons, onAllFilesLoaded);

        // local functions
        function readLocalJSON(element, callback) {
            var file = element.files[0];

            if (file) {
                // create a new file reader
                var reader = new FileReader();

                // the FileReader is asynchronous, so we set a callback function.
                // when the reader reads
                reader.onload = function (e) {
                    var value;
                    try {
                        value = JSON.parse(e.target.result);
                    }
                    catch (err) { }

                    callback.call(element, value);
                };

                // actually read the file
                reader.readAsText(file);
            }
        }

        // callbacks
        function onLibraryLoaded(value) {
            // add the data you are gonna use later.
            // here, we check if value is not undefined, and that it contains
            // a cells object.
            if (!value || !value.cells) {
                alert("Incorrect Standard Cell Library. Please choose the correct library and try again.");
                return false; // when we return false, the object loading fails, 
                // and the user has to choose another file.
            }
        }

        function onNetListLoaded(value) {
            // same as above
            if (!value) {
                alert("Incorrect Netlist file. Please choose the correct file and try again.")
                return false;
            }
        }

        function onAllFilesLoaded() {
            var SCL = app.library;
            var cells = SCL.cells;

            /*
            !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

	            To set weight of an existing edge, use the following
	            g.setEdge("v", "w", wire_delay)


	            To fetch the weight of an existing edge, use the following (not in the graphlib wiki)
	            g.edge({v:"in_name", w:"out_name"})

            !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
            */


            //Creates the DAG
            //For each gate, each input pin and each output pin is turned into a weighted node
            //Edges between input and output pins represent the time delay between the two.(GATE DELAY)
            //Edges between the output of a certain gate and the input of another represent the wire delay(WIRE DELAY)
            //WIRE DELAY NOT IMPLEMENTED BECAUSE VALUES COME FROM NET LIST CAPACITANCES FILE
            createNetlistDAG(app.netlist, SCL);

            //Calculate the time delay of each gate
            //For a certain gate, consideres both falling and rising delay and take the WORST VALUE(bigger value)
            //If the falling delay is taken, the falling output transition slew is also taken.
            //If the rising delay is taken, the rising output transition slew is taken.


            //injectNetCapacitance();
            calculateGateDelays();
            calculateFFAAT();
            calculateAAT();


            //initialise visited array to false, needed for identifyTimingPaths function
            for (var i = 0; i < g.nodes().length; i++)
                visited[g.nodes()[i]] = false;

            //loop over starting and ending nodes to identify the timing paths, > O(n^2), didn't calculate identifyTimingPaths
            for (var i in starting_nodes)
                for (var j in ending_nodes) {
                    current_path = [];
                    all_paths = [];
                    identifyTimingPaths(starting_nodes[i], ending_nodes[j]);
                    for (var k = 0; k < all_paths.length; k++)
                        printPath(all_paths[k]);
                }
        }

        //only deals with flattened modules for now
        function createNetlistDAG(vnetlist, SCL) {
            var library_cells = SCL.cells;      //return library cells
            var netlist_cells = vnetlist.modules[Object.keys(vnetlist.modules)[0]].cells; //returns netlist cells
            var netlist_ports = vnetlist.modules[Object.keys(vnetlist.modules)[0]].ports; //return netlist ports

            for (var cell in netlist_cells) {
                var current_cell = netlist_cells[cell];
                var cell_type = current_cell.type;
                var library_cell = library_cells[cell_type];
                var cell_inputs = [];		//keeps track of inputs of current cell
                var cell_outputs = [];		//keeps track of outputs of current cell

                for (var pin in current_cell.connections) {
                    var bit_id = current_cell.connections[pin][0];      //assumes gate deals with a max of 1 bit per pin
                    var pin_direction = library_cell.pins[pin].direction;
                    var pin_capacitance = library_cell.pins[pin].capacitance;

                    //NODE NAMES ARE CREATED HERE, CHANGE IF NECESSARY
                    var node_name = "U" + cell_count + "/" + pin + "_" + bit_id;//+ "_" + pin_direction;

                    if (pin_direction === "input") {
                        //First checks if cell is a flip flop
                        //if true, adds the D pin to the list of ending nodes
                        //Change this to make use of "is_ff" in library cells rather than indexOf("DFF")
                        if (cell_type.indexOf("DFF") > -1 && pin != "CLK" && pin != "R") {
                            flipflop_inputs.push(node_name)
                            ending_nodes.push(node_name)
                        }
                        cell_inputs.push(node_name);

                        if (bit_id in input_net_ids) input_net_ids[bit_id].push(node_name);
                        else input_net_ids[bit_id] = [node_name];

                        g.setNode(node_name, { pin_name: pin, type: cell_type, direction: pin_direction, capacitance: pin_capacitance, slew: 0, delay: 0, AAT: 0 });
                    }
                    else {
                        //Adds Q pin to list of starting nodes
                        //Change this to make use of is_ff in library cells
                        if (cell_type.indexOf("DFF") > -1) {
                            starting_nodes.push(node_name)
                            flipflop_outputs.push(node_name)
                        }
                        cell_outputs.push(node_name);

                        if (bit_id in output_net_ids) output_net_ids[bit_id].push(node_name);
                        else output_net_ids[bit_id] = [node_name];

                        g.setNode(node_name, {
                            pin_name: pin, type: cell_type, direction: pin_direction, capacitance: pin_capacitance,
                            timing: library_cell.pins[pin].timing, slew: 0, delay: 0, load_capacitance: 0, AAT: 0
                        });
                    }
                }

                //Make connections between cell pins(inputs to outputs)
                for (var i = 0; i < cell_inputs.length; i++)
                    for (var j = 0; j < cell_outputs.length; j++)
                        g.setEdge(cell_inputs[i], cell_outputs[j]);

                //Copies current output pin of cell to output_pins array
                //output_pins array to be used in calculateGateDelay to determine wheter a node is an output pin of a gate
                for (var i = 0; i < cell_outputs.length; i++)
                    output_pins.push(cell_outputs[i]);

                cell_count++;
            }

            //Connect wires between each gate(outputs to inputs) of weight(delay) equal to 0
            for (var output_id in output_net_ids)
                if (output_id in input_net_ids)
                    for (var i = 0; i < output_net_ids[output_id].length; i++)
                        for (var j = 0; j < input_net_ids[output_id].length; j++)
                            g.setEdge(output_net_ids[output_id][i], input_net_ids[output_id][j], 0);

            //Add input and output ports to the DAG
            for (var port_name in netlist_ports) {
                var port = netlist_ports[port_name];

                if (port.direction === "input") {
                    for (var i = 0; i < port.bits.length; i++) {
                        var node_name = port_name + "[" + i + "]";
                        g.setNode(node_name, { type: "input", direction: "input", capacitance: 0, delay: 0, AAT: 0 });

                        starting_nodes.push(node_name);
                        input_net_ids_node_names[port.bits[i]] = node_name;
                        for (var j = 0; j < input_net_ids[port.bits[i]].length; j++)
                            g.setEdge(node_name, input_net_ids[port.bits[i]][j], 0);
                    }
                }

                else {
                    for (var i = 0; i < port.bits.length; i++) {
                        var node_name = port_name + "[" + i + "]";
                        g.setNode(node_name, { type: "output", direction: "output", capacitance: 0, delay: 0, AAT: 0 });
                        output_ports.push(node_name);
                        ending_nodes.push(node_name);
                        output_net_ids_node_names[port.bits[i]] = node_name;
                        for (var j = 0; j < output_net_ids[port.bits[i]].length; j++)
                            g.setEdge(output_net_ids[port.bits[i]][j], node_name, 0);
                    }
                }
            }
        }
        function identifyTimingPaths(s, e) {
            if (s == e)
                all_paths.push(current_path.slice().concat(e));     //copy current_path, add ending node and push to all_paths
            else {
                visited[s] = true;
                current_path.push(s);
                for (var i = 0; i < g.outEdges(s).length; i++) {
                    if (visited[g.outEdges(s)[i].w] === false)
                        identifyTimingPaths(g.outEdges(s)[i].w, e);
                }
                visited[s] = false;
                current_path.pop();
            }
        }

        function calculateGateDelays() {
            var W = starting_nodes.slice();		//Makes a copy of starting_nodes instead of reference
            var edge_tracker = {};		//Keeps track of whether all the incoming edges of an output node have been traversed
            for (var vertex = 0; vertex < W.length; vertex++) {
                var nodes = g.outEdges(W[vertex]);

                for (var node in nodes) {
                    var pin = nodes[node].w;

                    //if pin in output pins
                    if (output_pins.indexOf(pin) > -1) {
                        var output_pin = g.node(pin);

                        var load_capacitance = 0.0;

                        for (var i = 0; i < g.outEdges(pin).length; i++)        //calculates load capacitance
                            load_capacitance += g.node(g.outEdges(pin)[i].w).capacitance + g.edge(g.outEdges(pin)[0]);

                        var output_pin_delay_info = calculatePinDelay(pin, W[vertex], load_capacitance);
                        g.setEdge(W[vertex], pin, output_pin_delay_info["delay"]);		//Set weight as time delay between input pin(W[vertex]) and output pin(pin)

                        if (output_pin_delay_info["delay"] > output_pin.delay) {
                            var output_slew = calculatePinSlewRate(pin, output_pin_delay_info["is_rise_transition"], W[vertex], load_capacitance);
                            output_pin.delay = output_pin_delay_info["delay"];
                            for (var i = 0; i < g.outEdges(pin).length; i++)        //adds correspoding slew to connected input gates
                                g.node(g.outEdges(pin)[i].w).slew = output_slew;
                        }

                        if (pin in edge_tracker)
                            edge_tracker[pin]++;
                        else
                            edge_tracker[pin] = 1;
                        if (g.nodeEdges(pin).length - g.outEdges(pin).length == edge_tracker[pin])
                            W.push(pin);

                    }
                    else
                        W.push(pin);
                }
            }
        }
        function calculatePinDelay(output_pin, input_pin, load_capacitance) {
            var input_slew = g.node(input_pin).slew;
            var input_pin_name = g.node(input_pin).pin_name;
            if (g.node(output_pin).type.indexOf("DFF") > -1)
                input_pin_name = "CLK";

            //possible x and y values of output delay NLDM table
            var falling_x_values = (g.node(output_pin).timing[input_pin_name].cell_fall.x_values).sort().slice();
            var falling_y_values = (g.node(output_pin).timing[input_pin_name].cell_fall.y_values).sort().slice();

            var falling_xs = getValuesAround(input_slew, falling_x_values);
            var falling_ys = getValuesAround(load_capacitance, falling_y_values);

            var Q11 = g.node(output_pin).timing[input_pin_name].cell_fall.table[falling_ys[0]][falling_xs[0]],
        		Q21 = g.node(output_pin).timing[input_pin_name].cell_fall.table[falling_ys[0]][falling_xs[1]],
        		Q12 = g.node(output_pin).timing[input_pin_name].cell_fall.table[falling_ys[1]][falling_xs[0]],
        		Q22 = g.node(output_pin).timing[input_pin_name].cell_fall.table[falling_ys[1]][falling_xs[1]];

            var falling_delay = calcBilinearInterpolantion(falling_xs[0], input_slew, falling_xs[1], falling_ys[0], load_capacitance, falling_ys[1], Q11, Q21, Q12, Q22);


            var rising_x_values = (g.node(output_pin).timing[input_pin_name].cell_rise.x_values).sort().slice();
            var rising_y_values = (g.node(output_pin).timing[input_pin_name].cell_rise.y_values).sort().slice();

            var rising_xs = getValuesAround(input_slew, rising_x_values);
            var rising_ys = getValuesAround(load_capacitance, rising_y_values);

            Q11 = g.node(output_pin).timing[input_pin_name].cell_rise.table[rising_ys[0]][rising_xs[0]];
            Q21 = g.node(output_pin).timing[input_pin_name].cell_rise.table[rising_ys[0]][rising_xs[1]];
            Q12 = g.node(output_pin).timing[input_pin_name].cell_rise.table[rising_ys[1]][rising_xs[0]];
            Q22 = g.node(output_pin).timing[input_pin_name].cell_rise.table[rising_ys[1]][rising_xs[1]];

            var rising_delay = calcBilinearInterpolantion(rising_xs[0], input_slew, rising_xs[1], rising_ys[0], load_capacitance, rising_ys[1], Q11, Q21, Q12, Q22);

            //what if falling == rising, what happens to input transition calculation?
            if (falling_delay > rising_delay)
                return { delay: falling_delay, is_rise_transition: false };
            else
                return { delay: rising_delay, is_rise_transition: true };

        }

        function calculatePinSlewRate(output_pin, is_rise_transition, input_pin, load_capacitance) {
            var input_slew = g.node(input_pin).slew;
            var output_slew = 0.0;

            var input_pin_name = g.node(input_pin).pin_name;
            if (g.node(output_pin).type.indexOf("DFF") > -1)
                input_pin_name = "CLK";

            if (is_rise_transition) {
                var rising_x_values = (g.node(output_pin).timing[input_pin_name].rise_transition.x_values).sort().slice();
                var rising_y_values = (g.node(output_pin).timing[input_pin_name].rise_transition.y_values).sort().slice();

                var rising_xs = getValuesAround(input_slew, rising_x_values);
                var rising_ys = getValuesAround(load_capacitance, rising_y_values);

                var Q11 = g.node(output_pin).timing[input_pin_name].rise_transition.table[rising_ys[0]][rising_xs[0]],
	        		Q21 = g.node(output_pin).timing[input_pin_name].rise_transition.table[rising_ys[0]][rising_xs[1]],
	        		Q12 = g.node(output_pin).timing[input_pin_name].rise_transition.table[rising_ys[1]][rising_xs[0]],
	        		Q22 = g.node(output_pin).timing[input_pin_name].rise_transition.table[rising_ys[1]][rising_xs[1]];

                output_slew = calcBilinearInterpolantion(rising_xs[0], input_slew, rising_xs[1], rising_ys[0], load_capacitance, rising_ys[1], Q11, Q21, Q12, Q22);
            }

            else {
                var falling_x_values = (g.node(output_pin).timing[input_pin_name].fall_transition.x_values).sort().slice();
                var falling_y_values = (g.node(output_pin).timing[input_pin_name].fall_transition.y_values).sort().slice();

                var falling_xs = getValuesAround(input_slew, falling_x_values);
                var falling_ys = getValuesAround(load_capacitance, falling_y_values);

                var Q11 = g.node(output_pin).timing[input_pin_name].fall_transition.table[falling_ys[0]][falling_xs[0]],
	        		Q21 = g.node(output_pin).timing[input_pin_name].fall_transition.table[falling_ys[0]][falling_xs[1]],
	        		Q12 = g.node(output_pin).timing[input_pin_name].fall_transition.table[falling_ys[1]][falling_xs[0]],
	        		Q22 = g.node(output_pin).timing[input_pin_name].fall_transition.table[falling_ys[1]][falling_xs[1]];

                output_slew = calcBilinearInterpolantion(falling_xs[0], input_slew, falling_xs[1], falling_ys[0], load_capacitance, falling_ys[1], Q11, Q21, Q12, Q22);
            }
            return output_slew;
        }

        function calculateAAT() {
            var W = starting_nodes.slice();		//Makes a copy of starting_nodes instead of reference

            var edge_tracker = {};		//Keeps track of whether all the incoming edges of an output node have been traversed
            for (var vertex = 0; vertex < W.length; vertex++) {
                var nodes = g.outEdges(W[vertex]);

                for (var node in nodes) {
                    var pin = nodes[node].w;

                    //if pin in output pins
                    if (output_pins.indexOf(pin) > -1) {
                        var output_pin = g.node(pin);
                        // wire delay + AAT of previous node + node delay
                        var output_AAT = g.node(g.inEdges(W[vertex])[0].v).delay + g.node(g.inEdges(W[vertex])[0].v).AAT + g.edge({ v: g.inEdges(W[vertex])[0].v, w: W[vertex] });

                        if (output_AAT > output_pin.AAT) {
                            output_pin.AAT = output_AAT;
                        }

                        if (pin in edge_tracker)
                            edge_tracker[pin]++;
                        else
                            edge_tracker[pin] = 1;
                        if (g.nodeEdges(pin).length - g.outEdges(pin).length == edge_tracker[pin])
                            W.push(pin);

                    }
                    else if (output_ports.indexOf(pin) > -1) {
                        var output_pin = g.node(pin);
                        var output_AAT = g.node(W[vertex]).delay + g.node(W[vertex]).AAT + g.edge({ v: W[vertex], w: pin });
                        if (output_AAT > output_pin.AAT) {
                            output_pin.AAT = output_AAT;
                        }

                        if (pin in edge_tracker)
                            edge_tracker[pin]++;
                        else
                            edge_tracker[pin] = 1;
                        if (g.nodeEdges(pin).length - g.outEdges(pin).length == edge_tracker[pin])
                            W.push(pin);
                    }
                    else
                        W.push(pin);
                }
            }
        }

        function calculateFFAAT() {
            /*
        	for(var output_pin in flipflop_outputs)
        		for(var input_pin in flipflop_outputs) {
        			current_path = [];
                    all_paths = [];
                    identifyTimingPaths(flipflop_outputs[output_pin], flipflop_outputs[input_pin]);
                    for (var k = 0; k < all_paths.length; k++)
                        printPath(all_paths[k]);*/
        }

        function injectNetCapacitance() {
            var bit_capacitances = {}
            var netnames = app["netlist"].modules[Object.keys(app["netlist"].modules)[0]].netnames; //returns netlist cells

            for (var net in app['netcapacitance']) {
                for (var bit in netnames[net].bits) {
                    bit_capacitances[netnames[net].bits[bit]] = app['netcapacitance'][net]
                }
            }

            for (var i in input_net_ids_node_names) {
                if (i in bit_capacitances)
                    for (var j = 0; j < input_net_ids[i].length; j++)
                        g.setEdge(input_net_ids_node_names[i], input_net_ids[i][j], bit_capacitances[i]);
            }

            for (var i in output_net_ids_node_names) {
                if (i in bit_capacitances)
                    for (var j = 0; j < output_net_ids[i].length; j++)
                        g.setEdge(output_net_ids[i][j], output_net_ids_node_names[i], bit_capacitances[i]);
            }

            for (var i in output_net_ids_node_names) {
                if (i in bit_capacitances && i in input_net_ids_node_names)
                    for (var j = 0; j < output_net_ids[i].length; j++) {
                        g.setEdge(output_net_ids[i][j], output_net_ids_node_names[i], bit_capacitances[i]);
                    }
            }


            for (var output_id in output_net_ids)
                if (output_id in input_net_ids && output_id in bit_capacitances)
                    for (var i = 0; i < output_net_ids[output_id].length; i++)
                        for (var j = 0; j < input_net_ids[output_id].length; j++) {
                            g.setEdge(output_net_ids[output_id][i], input_net_ids[output_id][j], bit_capacitances[output_id]);
                        }

        }

        function printPath(path) {
            var total_delay = 0.0;
            var delay, node;

            var table = $("<table></table>")
                        .append("<thead><tr></tr></thead>")
                        .append("<tbody/>");

            var head = table.find("thead > tr");
            ['Pin', 'Type', 'Incr', 'Total Delay', 'Test'].forEach(function (th) {
                head.append($("<th/>", {
                    html: th
                }));
            });

            var body = table.find("tbody");
            for (var i = 0; i < path.length; i++) {
                node = g.node(path[i]);
                delay = 0.0;

                /*if (node.type.indexOf("DFF") > -1 && node.direction == "output") {     //handles flip-flops
                    node.timing["CLK"];//ADD STUFF HERE
                }
                else if (node.type != "output" && node.direction == "output") {
                    var prev_pin_name = g.node(path[i - 1]).pin_name;
                    var load_capacitance = 0.0;
                    for (var j = 0; j < g.outEdges(path[i]).length; j++)        //calculates load capacitance
                        load_capacitance += g.node(g.outEdges(path[i])[j].w).capacitance;
                
                    //for cell fall
                    var cell_fall_x = closest(transition_time, node.timing[prev_pin_name].cell_fall.x_values);
                    var cell_fall_y = closest(load_capacitance, node.timing[prev_pin_name].cell_fall.y_values);
                    var cell_fall_delay = node.timing[prev_pin_name].cell_fall.table[cell_fall_y][cell_fall_x];
                
                    //for cell rise 
                    var cell_rise_x = closest(transition_time, node.timing[prev_pin_name].cell_rise.x_values);
                    var cell_rise_y = closest(load_capacitance, node.timing[prev_pin_name].cell_rise.y_values);
                    var cell_rise_delay = node.timing[prev_pin_name].cell_rise.table[cell_rise_y][cell_rise_x];
                
                    //picks which transition time to choose
                    if (cell_rise_delay > cell_fall_delay) {
                        var cell_rise_transition_x = closest(transition_time, node.timing[prev_pin_name].rise_transition.x_values);
                        var cell_rise_transition_y = closest(load_capacitance, node.timing[prev_pin_name].rise_transition.y_values);
                        transition_time += node.timing[prev_pin_name].rise_transition.table[cell_rise_transition_y][cell_rise_transition_x];
                        delay = cell_rise_delay;
                    }
                    else {
                        var cell_fall_transition_x = closest(transition_time, node.timing[prev_pin_name].fall_transition.x_values);
                        var cell_fall_transition_y = closest(load_capacitance, node.timing[prev_pin_name].fall_transition.y_values);
                        transition_time += node.timing[prev_pin_name].fall_transition.table[cell_fall_transition_y][cell_fall_transition_x];
                        delay = cell_fall_delay;
                    }
                    total_delay += delay;*/

                total_delay += node.delay;

                var row = $("<tr/>");
                [
                    path[i],
                    node.type,
                    Math.round(node.delay * 1000),
                    Math.round(total_delay * 1000),
                    Math.round(node.AAT * 1000)
                ].forEach(function (td) {
                    row.append($("<td/>", {
                        html: td
                    }));
                });
                body.append(row);
            }

            $("#output")
                .append(table)
                .append("<br/>");
        }

        //no need for bisection method, small size
        //Array needs to be sorted for this to work
        function getValuesAround(num, arr) {
            for (var i = 1; i < arr.length; i++)
                if (arr[i] >= num)
                    return [arr[i - 1], arr[i]];

            //if num > any element in the array, fetch the last two
            return [arr[arr.length - 2], arr[arr.length - 1]];
        }

        //Performs Bilinear interpolation
        //Mathematic equations taken from
        //http://www.ajdesigner.com/phpinterpolation/bilinear_interpolation_equation.php
        function calcBilinearInterpolantion(x1, x, x2, y1, y, y2, Q11, Q21, Q12, Q22) {
            var ans1 = (((x2 - x) * (y2 - y)) / ((x2 - x1) * (y2 - y1))) * Q11;
            var ans2 = (((x - x1) * (y2 - y)) / ((x2 - x1) * (y2 - y1))) * Q21;
            var ans3 = (((x2 - x) * (y - y1)) / ((x2 - x1) * (y2 - y1))) * Q12;
            var ans4 = (((x - x1) * (y - y1)) / ((x2 - x1) * (y2 - y1))) * Q22;
            return (ans1 + ans2 + ans3 + ans4);
        }
    }();
});