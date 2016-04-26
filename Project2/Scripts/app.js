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
            createNetlistDAG(app["netlist"], SCL);
            calculateGateDelays();
            //initialise visited array to false
            for (var i = 0; i < g.nodes().length; i++)
                visited[g.nodes()[i]] = false;

            //loop over inputs and outputs timing paths, > O(n^2), didn't calculate identifyTimingPaths
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

            var input_net_ids = {};
            var output_net_ids = {};

            for (var cell in netlist_cells) {
                var current_cell = netlist_cells[cell];
                var cell_type = current_cell.type;
                var library_cell = library_cells[cell_type];
                var cell_inputs = [];
                var cell_outputs = [];

                //CHECK IF FLIP FLOP HERE
                for (var pin in current_cell.connections) {
                    var bit_id = current_cell.connections[pin][0];      //assumes gate deals with a max of 1 bit per pin
                    var pin_direction = library_cell.pins[pin].direction;
                    var pin_capacitance = library_cell.pins[pin].capacitance;
                    var node_name = "U" + cell_count + "/" + pin + "_" + bit_id;//+ "_" + pin_direction;

                    if (pin_direction === "input") {
                        if (cell_type.indexOf("DFF") > -1 && pin != "CLK" && pin != "R")        //change this to make use of is_ff in library cells
                            ending_nodes.push(node_name)
                        cell_inputs.push(node_name);
                        if (bit_id in input_net_ids) input_net_ids[bit_id].push(node_name);
                        else input_net_ids[bit_id] = [node_name];
                        g.setNode(node_name, { pin_name: pin, type: cell_type, direction: pin_direction, capacitance: pin_capacitance, slew: 0, delay: 0});
                    }
                    else {
                        if (cell_type.indexOf("DFF") > -1)                                      //change this to make use of is_ff in library cells
                            starting_nodes.push(node_name)
                        cell_outputs.push(node_name);
                        if (bit_id in output_net_ids) output_net_ids[bit_id].push(node_name);
                        else output_net_ids[bit_id] = [node_name];
                        g.setNode(node_name, { pin_name: pin, type: cell_type, direction: pin_direction, capacitance: pin_capacitance, timing: library_cell.pins[pin].timing, slew: 0, delay: 0 });
                    }
                }

                //make connections between cell pins(inputs to outputs)
                //ADD CELL DELAY IN THIS LOOP
                for (var i = 0; i < cell_inputs.length; i++)
                    for (var j = 0; j < cell_outputs.length; j++)
                        g.setEdge(cell_inputs[i], cell_outputs[j]);

                cell_count++;
                for(var i = 0; i < cell_outputs.length; i++)
                	output_pins.push(cell_outputs[i]);
            }
            //making wire connections between gates
            //ADD WIRE DELAY HERE(IF ANY)
            for (var output_id in output_net_ids)
                if (output_id in input_net_ids)
                    for (var i = 0; i < output_net_ids[output_id].length; i++)
                        for (var j = 0; j < input_net_ids[output_id].length; j++)
                            g.setEdge(output_net_ids[output_id][i], input_net_ids[output_id][j]);


            //add input and outputs nodes to graph
            for (var port_name in netlist_ports) {
                var port = netlist_ports[port_name];

                if (port.direction === "input") {
                    for (var i = 0; i < port.bits.length; i++) {
                        var node_name = port_name + "[" + i + "]";
                        g.setNode(node_name, { type: "input", direction: "input", capacitance: 0 });
                        starting_nodes.push(node_name);
                        for (var j = 0; j < input_net_ids[port.bits[i]].length; j++)
                            g.setEdge(node_name, input_net_ids[port.bits[i]][j]);
                    }
                }

                else {
                    for (var i = 0; i < port.bits.length; i++) {
                        var node_name = port_name + "[" + i + "]";
                        g.setNode(node_name, { type: "output", direction: "output", capacitance: 0 });
                        ending_nodes.push(node_name);
                        for (var j = 0; j < output_net_ids[port.bits[i]].length; j++)
                            g.setEdge(output_net_ids[port.bits[i]][j], node_name);
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
                        identifyTimingPaths(g.outEdges(s)[i].w, e)
                }
                visited[s] = false;
                current_path.pop();
            }
        }

        function calculateGateDelays() {
        	var W = starting_nodes.slice();
        	var edge_tracker = {};
        	for(var vertex = 0; vertex < W.length; vertex++) {
        		var nodes = g.outEdges(W[vertex]);
        		for(var node in nodes) {
        			var pin = nodes[node].w;
        			if(output_pins.indexOf(pin) > -1) {
        				//DO DELAY COMPUTATION HERE
        				if(pin in edge_tracker)
        					edge_tracker[pin]++;
        				else
        					edge_tracker[pin] = 1;
        				if(g.nodeEdges(pin).length - g.outEdges(pin).length == edge_tracker[pin]) {
        					W.push(pin)
        				}
        				}
        			else
        				W.push(pin);
        		}
        	}
        }

        function printPath(path) {
            var total_delay = 0.0;
            var transition_time = 0.0;
            var delay;
            var node;
            $(".output").append("--------------------------------------------</br>");
            $(".output").append("Pin&emsp;&emsp;Type</br>");
            for (var i = 0; i < path.length; i++) {
                node = g.node(path[i]);
                delay = 0.0
                if (node.type.indexOf("DFF") > -1 && node.direction == "output") {     //handles flip-flops
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
                    total_delay += delay;
                }
                $(".output").append(path[i] + "&emsp;&emsp;" + g.node(path[i]).type +"&emsp;&emsp;" + Math.round(delay*1000) + "&emsp;&emsp;" + Math.round(total_delay*1000) + "</br>");
            }
        }

        //no need for bisection method, small size
        function closest(num, arr) {
            var curr = arr[0];
            var diff = Math.abs(num - curr);
            for (var val = 0; val < arr.length; val++) {
                var newdiff = Math.abs(num - arr[val]);
                if (newdiff < diff) {
                    diff = newdiff;
                    curr = arr[val];
                }
            }
            return curr;
        }

        function calcBilinearInterpolant(x1,x,x2,y1,y,y2,Q11,Q21,Q12,Q22) {
    
		    /**
		     * (x1, y1) - coordinates of corner 1 - [Q11]
		     * (x2, y1) - coordinates of corner 2 - [Q21]
		     * (x1, y2) - coordinates of corner 3 - [Q12]
		     * (x2, y2) - coordinates of corner 4 - [Q22]
		     * 
		     * (x, y)   - coordinates of interpolation
		     * 
		     * Q11      - corner 1
		     * Q21      - corner 2
		     * Q12      - corner 3
		     * Q22      - corner 4
		    */
		    
		    var ans1 = (((x2-x)*(y2-y))/((x2-x1)*(y2-y1)))*Q11;
		    var ans2 = (((x-x1)*(y2-y))/((x2-x1)*(y2-y1)))*Q21;
		    var ans3 = (((x2-x)*(y-y1))/((x2-x1)*(y2-y1)))*Q12;
		    var ans4 = (((x-x1)*(y-y1))/((x2-x1)*(y2-y1)))*Q22;
		    return (ans1+ans2+ans3+ans4);
		}
    };
});