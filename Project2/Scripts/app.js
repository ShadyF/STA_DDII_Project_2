/// <reference path="jquery-2.2.2.min.js" />

var app;
$(function () {
    "use strict";

    app = new function () {
        var that = this;

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

        var loadingElements = {
            itemsCount: 0,
            elements: [{
                elName: "libraryInput",
                varName: "library",
                loaded: false,
                onLoaded: onLibraryLoaded
            }, {
                elName: "netListInput",
                varName: "netlist",
                loaded: false,
                onLoaded: onNetListLoaded
            }, {
                elName: "netCapacitance",
                varName: "netcapacitance",
                loaded: false,
                onLoaded: onNetListLoaded
            }]
        }

        function readLocalJSON(el, fn) {
            var file = el.files[0];

            if (file) {
                var reader = new FileReader();

                reader.onload = function (e) {
                    fn.call($(el), JSON.parse(e.target.result));
                };
                reader.readAsText(file);
            }
        }

        for (var i = 0; i < loadingElements.elements.length; ++i) {
            var item = loadingElements.elements[i];
            (function (item) {
                $(document).on("change", "#" + item.elName, function (event) {
                    readLocalJSON(this, function (result) {
                        ++loadingElements.itemsCount;
                        item.loaded = true;
                        that[item.varName] = result;

                        this.prev("label").hide();
                        this.hide();
                        $("<label></label>")
                            .html(this.val() + " has been loaded!")
                            .insertBefore(this);

                        if (item.onLoaded)
                            item.onLoaded.call(this);

                        if (loadingElements.itemsCount === loadingElements.elements.length)
                            onAllJsonFilesLoaded();
                    });
                });
            })(item);
        }


        function onLibraryLoaded() {
            alert("when library is loaded");
        }

        function onNetListLoaded(result) {
            // if you need to do anything after the netlist has been loaded
            alert("when netlist is loaded");
        }

        function onAllJsonFilesLoaded() {
            var SCL = app["library"];
            var cells = SCL.cells;

            console.log(SCL);
            console.log(app["netlist"]);
            console.log(app["netcapacitance"])

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
            createNetlistDAG(app["netlist"], SCL);

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
            alert("all loaded");
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

                        g.setNode(node_name, { pin_name: pin, type: cell_type, direction: pin_direction, capacitance: pin_capacitance, slew: 0, delay: 0, AAT:0 } );
                    }
                    else {
                    	//Adds Q pin to list of starting nodes
                    	//Change this to make use of is_ff in library cells
                        if (cell_type.indexOf("DFF") > -1){                                      
                            starting_nodes.push(node_name)
                            flipflop_outputs.push(node_name)
                        }
                        cell_outputs.push(node_name);

                        if (bit_id in output_net_ids) output_net_ids[bit_id].push(node_name);
                        else output_net_ids[bit_id] = [node_name];

                        g.setNode(node_name, { pin_name: pin, type: cell_type, direction: pin_direction, capacitance: pin_capacitance,
                        						timing: library_cell.pins[pin].timing, slew: 0, delay: 0, load_capacitance: 0, AAT: 0});
                    }
                }

                //Make connections between cell pins(inputs to outputs)
                for (var i = 0; i < cell_inputs.length; i++)
                    for (var j = 0; j < cell_outputs.length; j++)
                        g.setEdge(cell_inputs[i], cell_outputs[j]);

                //Copies current output pin of cell to output_pins array
                //output_pins array to be used in calculateGateDelay to determine wheter a node is an output pin of a gate
                for(var i = 0; i < cell_outputs.length; i++)
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
                        g.setNode(node_name, { type: "input", direction: "input", capacitance: 0, delay: 0, AAT: 0});

                        starting_nodes.push(node_name);
                        input_net_ids_node_names[port.bits[i]] = node_name;
                        for (var j = 0; j < input_net_ids[port.bits[i]].length; j++)
                            g.setEdge(node_name, input_net_ids[port.bits[i]][j], 0);
                    }
                }

                else {
                    for (var i = 0; i < port.bits.length; i++) {
                        var node_name = port_name + "[" + i + "]";
                        g.setNode(node_name, { type: "output", direction: "output", capacitance: 0, delay: 0, AAT: 0});
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
        	for(var vertex = 0; vertex < W.length; vertex++) {
        		var nodes = g.outEdges(W[vertex]);

        		for(var node in nodes) {
        			var pin = nodes[node].w;

        			//if pin in output pins
        			if(output_pins.indexOf(pin) > -1) {
        				var output_pin = g.node(pin);

        				var load_capacitance = 0.0;

        				for (var i = 0; i < g.outEdges(pin).length; i++)        //calculates load capacitance
        					load_capacitance += g.node(g.outEdges(pin)[i].w).capacitance + g.edge(g.outEdges(pin)[0]);

        				var output_pin_delay_info = calculatePinDelay(pin, W[vertex], load_capacitance);
        				g.setEdge(W[vertex], pin, output_pin_delay_info["delay"]);		//Set weight as time delay between input pin(W[vertex]) and output pin(pin)

        				if(output_pin_delay_info["delay"] > output_pin.delay) {
        					var output_slew = calculatePinSlewRate(pin, output_pin_delay_info["is_rise_transition"], W[vertex], load_capacitance);
        					output_pin.delay = output_pin_delay_info["delay"];
        					for (var i = 0; i < g.outEdges(pin).length; i++)        //adds correspoding slew to connected input gates
        						g.node(g.outEdges(pin)[i].w).slew = output_slew; 
        				}

        				if(pin in edge_tracker)
        					edge_tracker[pin]++;
        				else
        					edge_tracker[pin] = 1;
        				if(g.nodeEdges(pin).length - g.outEdges(pin).length == edge_tracker[pin])
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
        	if(g.node(output_pin).type.indexOf("DFF") > -1)
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

			var falling_delay = calcBilinearInterpolantion(falling_xs[0],input_slew,falling_xs[1],falling_ys[0],load_capacitance,falling_ys[1],Q11,Q21,Q12,Q22);


        	var rising_x_values = (g.node(output_pin).timing[input_pin_name].cell_rise.x_values).sort().slice();
        	var rising_y_values = (g.node(output_pin).timing[input_pin_name].cell_rise.y_values).sort().slice();

			var rising_xs = getValuesAround(input_slew, rising_x_values);
        	var rising_ys = getValuesAround(load_capacitance, rising_y_values);

			Q11 = g.node(output_pin).timing[input_pin_name].cell_rise.table[rising_ys[0]][rising_xs[0]];
        	Q21 = g.node(output_pin).timing[input_pin_name].cell_rise.table[rising_ys[0]][rising_xs[1]];
        	Q12 = g.node(output_pin).timing[input_pin_name].cell_rise.table[rising_ys[1]][rising_xs[0]];
        	Q22 = g.node(output_pin).timing[input_pin_name].cell_rise.table[rising_ys[1]][rising_xs[1]];

        	var rising_delay = calcBilinearInterpolantion(rising_xs[0],input_slew,rising_xs[1],rising_ys[0],load_capacitance,rising_ys[1],Q11,Q21,Q12,Q22);

        	//what if falling == rising, what happens to input transition calculation?
        	if(falling_delay > rising_delay)
        		return {delay: falling_delay, is_rise_transition: false};
        	else
        		return {delay: rising_delay, is_rise_transition: true};

        }

        function calculatePinSlewRate(output_pin, is_rise_transition, input_pin, load_capacitance) {
        	var input_slew = g.node(input_pin).slew;
        	var output_slew = 0.0;

        	var input_pin_name = g.node(input_pin).pin_name;
        	if(g.node(output_pin).type.indexOf("DFF") > -1)
        		input_pin_name = "CLK";

        	if(is_rise_transition) {
        		var rising_x_values = (g.node(output_pin).timing[input_pin_name].rise_transition.x_values).sort().slice();
	        	var rising_y_values = (g.node(output_pin).timing[input_pin_name].rise_transition.y_values).sort().slice();

	        	var rising_xs = getValuesAround(input_slew, rising_x_values);
	        	var rising_ys = getValuesAround(load_capacitance, rising_y_values);

	        	var Q11 = g.node(output_pin).timing[input_pin_name].rise_transition.table[rising_ys[0]][rising_xs[0]],
	        		Q21 = g.node(output_pin).timing[input_pin_name].rise_transition.table[rising_ys[0]][rising_xs[1]],
	        		Q12 = g.node(output_pin).timing[input_pin_name].rise_transition.table[rising_ys[1]][rising_xs[0]],
	        		Q22 = g.node(output_pin).timing[input_pin_name].rise_transition.table[rising_ys[1]][rising_xs[1]];

				output_slew = calcBilinearInterpolantion(rising_xs[0],input_slew,rising_xs[1],rising_ys[0],load_capacitance,rising_ys[1],Q11,Q21,Q12,Q22);
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

				output_slew = calcBilinearInterpolantion(falling_xs[0],input_slew,falling_xs[1],falling_ys[0],load_capacitance,falling_ys[1],Q11,Q21,Q12,Q22);
        	}
        	return output_slew;
        }

        function calculateAAT() {
        	var W = starting_nodes.slice();		//Makes a copy of starting_nodes instead of reference

        	var edge_tracker = {};		//Keeps track of whether all the incoming edges of an output node have been traversed
        	for(var vertex = 0; vertex < W.length; vertex++) {
        		var nodes = g.outEdges(W[vertex]);

        		for(var node in nodes) {
        			var pin = nodes[node].w;

        			//if pin in output pins
        			if(output_pins.indexOf(pin) > -1) {
        				var output_pin = g.node(pin);
        				var output_AAT = g.node(g.inEdges(W[vertex])[0].v).delay + g.node(g.inEdges(W[vertex])[0].v).AAT + g.edge({v:g.inEdges(W[vertex])[0].v, w:W[vertex]});

        				 if(output_AAT > output_pin.AAT) {
        				 	output_pin.AAT = output_AAT;
        				}

        				if(pin in edge_tracker)
        					edge_tracker[pin]++;
        				else
        					edge_tracker[pin] = 1;
        				if(g.nodeEdges(pin).length - g.outEdges(pin).length == edge_tracker[pin])
        					W.push(pin);
        				
        				}
        			else if(output_ports.indexOf(pin) > -1) {
        				var output_pin = g.node(pin);
        				var output_AAT = g.node(W[vertex]).delay + g.node(W[vertex]).AAT + g.edge({v:W[vertex], w: pin});
        				 if(output_AAT > output_pin.AAT) {
        				 	output_pin.AAT = output_AAT;
        				}

        				if(pin in edge_tracker)
        					edge_tracker[pin]++;
        				else
        					edge_tracker[pin] = 1;
        				if(g.nodeEdges(pin).length - g.outEdges(pin).length == edge_tracker[pin])
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

        	for(var net in app['netcapacitance']) {
        		for(var bit in netnames[net].bits) {
        			bit_capacitances[netnames[net].bits[bit]] = app['netcapacitance'][net]
        		}
        	}

        	for (var i in input_net_ids_node_names) {
        		if(i in bit_capacitances)
        			for(var j = 0; j < input_net_ids[i].length; j++) 
        				g.setEdge(input_net_ids_node_names[i], input_net_ids[i][j], bit_capacitances[i]);
        	}

        	for (var i in output_net_ids_node_names) {
        		if(i in bit_capacitances)
        			for(var j = 0; j < output_net_ids[i].length; j++) 
        				g.setEdge(output_net_ids[i][j], output_net_ids_node_names[i], bit_capacitances[i]);        			
        	}

        	for (var i in output_net_ids_node_names) {
        		if(i in bit_capacitances && i in input_net_ids_node_names)
        			for(var j = 0; j < output_net_ids[i].length; j++) {
        				g.setEdge(output_net_ids[i][j], output_net_ids_node_names[i], bit_capacitances[i]);
        			}
        	}


        	for (var output_id in output_net_ids)
        		if (output_id in input_net_ids && output_id in bit_capacitances)
                    for (var i = 0; i < output_net_ids[output_id].length; i++)
                        for (var j = 0; j < input_net_ids[output_id].length; j++){
                            	g.setEdge(output_net_ids[output_id][i], input_net_ids[output_id][j], bit_capacitances[output_id]);
                            } 

        }

        function printPath(path) {
            var total_delay = 0.0;
            var delay, node;
            $(".output").append("--------------------------------------------</br>");
            $(".output").append("Pin&emsp;&emsp;Type&emsp;&emsp;Incr&emsp;&emsp;Total Delay</br>");
            for (var i = 0; i < path.length; i++) {
                node = g.node(path[i]);
                delay = 0.0;

/*                if (node.type.indexOf("DFF") > -1 && node.direction == "output") {     //handles flip-flops
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
                total_delay += node.delay
                $(".output").append(path[i] + "&emsp;&emsp;" + node.type +"&emsp;&emsp;" + Math.round(node.delay*1000) + "&emsp;&emsp;" + Math.round(total_delay*1000)
                					+ "&emsp;&emsp;"+ Math.round(node.AAT*1000) + "</br>");
            }
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
        function calcBilinearInterpolantion(x1,x,x2,y1,y,y2,Q11,Q21,Q12,Q22) {	
		    var ans1 = (((x2-x)*(y2-y))/((x2-x1)*(y2-y1)))*Q11;
		    var ans2 = (((x-x1)*(y2-y))/((x2-x1)*(y2-y1)))*Q21;
		    var ans3 = (((x2-x)*(y-y1))/((x2-x1)*(y2-y1)))*Q12;
		    var ans4 = (((x-x1)*(y-y1))/((x2-x1)*(y2-y1)))*Q22;
		    return (ans1 + ans2 + ans3 + ans4);
		}
    };
});