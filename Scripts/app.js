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
        var input_ports = [];
        var output_ports = [];
        var input_net_ids = {};
        var output_net_ids = {};
        var input_net_ids_node_names = {};
        var output_net_ids_node_names = {};
        var flipflop_outputs = [];
        var flipflop_inputs = [];
        var flipflop_outputs_by_cell_name = {};

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
            }, {
                elName: "timingConstraints",
                varName: "timingconstraints",
                loaded: false,
                onLoaded: onNetListLoaded
            },{
                elName: "clockSkews",
                varName: "clock_skews",
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


            injectNetCapacitance();
            injectInputDelays();
            injectOutputDelays();
            injectClockSkews();
            calculateGateDelays();
            injectHoldTimes();
            calculateFFAAT();
            calculateAAT();
            calculateFFRT();
            calculateRT();


            //initialise visited array to false, needed for identifyTimingPaths function
            for (var i = 0; i < g.nodes().length; i++)
                visited[g.nodes()[i]] = false;

            //loop over starting and ending nodes to identify the timing paths, > O(n^2), didn't calculate identifyTimingPaths
            var timing_paths = [];
            var flag = true;
            for (var i in starting_nodes)
                for (var j in ending_nodes) {
                    current_path = [];
                    all_paths = [];
                    identifyTimingPaths(starting_nodes[i], ending_nodes[j]);
                    for (var k = 0; k < all_paths.length; k++) {
                    	flag = true;
                    	for(var l = 1; l < all_paths[k].length - 1; l++)
                    		if(g.node(all_paths[k][l]).type.indexOf("DFF") > -1)
                    			flag = false;

                        if(flag) timing_paths.push(all_paths[k])

                    }
                }
            var cell_paths = {};

            for(var i = 0; i < timing_paths.length; i++) {
              if(g.node(timing_paths[i][0]).cell_name in cell_paths){
                if(cell_paths[g.node(timing_paths[i][0]).cell_name].indexOf(g.node(timing_paths[i][timing_paths[i].length - 1]).cell_name) == -1)
                  cell_paths[g.node(timing_paths[i][0]).cell_name].push(g.node(timing_paths[i][timing_paths[i].length - 1]).cell_name)
                }
              else {
                cell_paths[g.node(timing_paths[i][0]).cell_name] = [];
                cell_paths[g.node(timing_paths[i][0]).cell_name].push(g.node(timing_paths[i][timing_paths[i].length - 1]).cell_name)
              }
            }
            $("#output").append("<br/>ALL VALUES IN PS<br/>")
            $("#output").append("<br/>Identified Timing Paths<br/>")
            $("#output").append("------------------------------------------<br/>")
            for(var i in cell_paths)
              for(var j = 0; j < cell_paths[i].length; j++)
                $("#output").append("FROM  " + i + "  TO  " + cell_paths[i][j] + "<br/>")
            $("#output").append("<br/>")

            var table = $("<table></table>")
                        .append("<thead><tr></tr></thead>")
                        .append("<tbody/>");

            var head = table.find("thead > tr");
            ['Cell Name', 'Type', 'AAT', 'RT', 'Slack', "Timing(Setup) Violation"].forEach(function (th) {
                head.append($("<th/>", {
                    html: th
                }));
            });
            var body = table.find("tbody");
            for(var i in output_pins) {
                var node = g.node(output_pins[i]);
                var slack = Math.round((node.RT - node.AAT) * 1000);
                var flag;
                if(slack < 0)
                  flag = "Yes"
                else {
                  flag = "No"
                }
                var row = $("<tr/>");
                [
                    node.cell_name,
                    node.type,
                    Math.round(node.AAT * 1000),
                    Math.round(node.RT * 1000),
                    slack,
                    flag
                ].forEach(function (td) {
                    row.append($("<td/>", {
                        html: td
                    }));
                });
                body.append(row);
              }
          for(var i in output_ports)
          {
            var node = g.node(output_ports[i]);
            var slack = Math.round((node.RT - node.AAT) * 1000);
            var flag;
            if(slack < 0)
              flag = "Yes"
            else {
              flag = "No"
            }
            var row = $("<tr/>");
            [
                node.cell_name + "[" + node.array_id +"]",
                node.type,
                Math.round(node.AAT * 1000),
                Math.round(node.RT * 1000),
                slack,
                flag
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

          var hold_time_violation_exists = false;
          for(var i in timing_paths)
            if(g.node(timing_paths[i][timing_paths[i].length - 1]).pin_name == "D") {
              var total_delay = 0.0;
              for(var j = 0; j < timing_paths[i].length; j++) {
                total_delay += g.node(timing_paths[i][j]).delay;
              }
              var node_Q = g.node(g.outEdges(timing_paths[i][timing_paths[i].length - 1])[0].w)
              var left_hand_side = total_delay + node_Q.delay - node_Q.skew;   //Tpd + Tcq - Tskew
              if (left_hand_side < g.node(timing_paths[i][timing_paths[i].length - 1]).hold_time) {
                $("#output").append("Hold Time Violation at " + node_Q.cell_name + " : Thold(" + Math.round(g.node(timing_paths[i][timing_paths[i].length - 1]).hold_time*1000)+") > " + Math.round(left_hand_side*1000) +"<br/>")
                hold_time_violation_exists = true;
              }
            }

            if(!hold_time_violation_exists)
                $("#output").append("No Hold Time Violation Exists<br/><br/>")

            $("#output").append("Critical Path:<br/><br/>")

            var critical_path_delay = 0.0
            var critical_path_index = 0
            for(var i = 0; i < timing_paths.length; i++) {
              var delay = 0.0;
              for(var j = 0; j < timing_paths[i].length; j++) {
                var node = g.node(timing_paths[i][j]);
                delay += node.delay;
                if(delay > critical_path_delay) {
                  critical_path_delay = delay;
                  critical_path_index = i;
                }
              }
            }
            printPath(timing_paths[critical_path_index]);
            $("#output").append("<br/><br/> Paths with least slacks(Only a maximun of 10 displayed) <br/><br/>")
            var slacks = {};
            for(var i in timing_paths){
                if(g.node(timing_paths[i][timing_paths[i].length - 1]).type.indexOf("DFF") > -1) {
                    slacks[i] = g.node(g.outEdges(timing_paths[i][timing_paths[i].length - 1])[0].w).RT - g.node(g.outEdges(timing_paths[i][timing_paths[i].length - 1])[0].w).AAT
                  }
                else
                    slacks[i] = g.node(timing_paths[i][timing_paths[i].length - 1]).RT - g.node(timing_paths[i][timing_paths[i].length - 1]).AAT
              }
;
            var sorted_slacks = Object.keys(slacks).sort(function(a, b) {return slacks[a] - slacks[b]})
            for(var i = 0; i < sorted_slacks.length && i < 50; i++)
                printPath(timing_paths[Number(sorted_slacks[i])], slacks[sorted_slacks[i]])

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
                        if (cell_type.indexOf("DFF") > -1 && pin != "R") {
                            if(pin != "CLK")
                        	     flipflop_inputs.push(node_name)
                            ending_nodes.push(node_name)
                        }
                        cell_inputs.push(node_name);

                        if (bit_id in input_net_ids) input_net_ids[bit_id].push(node_name);
                        else input_net_ids[bit_id] = [node_name];

                        g.setNode(node_name, { cell_name: cell, pin_name: pin, type: cell_type, direction: pin_direction, capacitance: pin_capacitance, slew: 0, delay: 0, AAT:0, RT: 0, skew: 0 } );
                    }
                    else {
                    	//Adds Q pin to list of starting nodes
                    	//Change this to make use of is_ff in library cells
                        if (cell_type.indexOf("DFF") > -1){
                            starting_nodes.push(node_name)
                            flipflop_outputs.push(node_name)
                            flipflop_outputs_by_cell_name[cell] = node_name;
                        }
                        cell_outputs.push(node_name);

                        if (bit_id in output_net_ids) output_net_ids[bit_id].push(node_name);
                        else output_net_ids[bit_id] = [node_name];

                        g.setNode(node_name, { cell_name: cell, pin_name: pin, type: cell_type, direction: pin_direction, capacitance: pin_capacitance,
                        						timing: library_cell.pins[pin].timing, slew: 0, delay: 0, load_capacitance: 0, AAT: 0, RT: Infinity, skew: 0});
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
                        g.setNode(node_name, {cell_name: port_name, type: "input", direction: "input", capacitance: 0, delay: 0, AAT: 0, RT: 0});
                        input_ports.push(node_name)
                        starting_nodes.push(node_name);
                        input_net_ids_node_names[port.bits[i]] = node_name;
                        for (var j = 0; j < input_net_ids[port.bits[i]].length; j++)
                            g.setEdge(node_name, input_net_ids[port.bits[i]][j], 0);
                    }
                }

                else {
                    for (var i = 0; i < port.bits.length; i++) {
                        var node_name = port_name + "[" + i + "]";
                        g.setNode(node_name, {array_id: i, cell_name: port_name, type: "output", direction: "output", capacitance: 0, delay: 0, AAT: 0, RT: Infinity});
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
        	var W = input_ports.slice();		//Makes a copy of starting_nodes instead of reference
        	for(var pin in flipflop_outputs)
        	{
        		var load_capacitance = 0.0;
        		for (var i = 0; i < g.outEdges(flipflop_outputs[pin]).length; i++)        //calculates load capacitance
        			load_capacitance += g.node(g.outEdges(flipflop_outputs[pin])[i].w).capacitance + g.edge(g.outEdges(flipflop_outputs[pin])[0]);

        		var output_pin_delay_info = calculatePinDelay(flipflop_outputs[pin], "CLK", load_capacitance);

        		if(output_pin_delay_info["delay"] > g.node(flipflop_outputs[pin]).delay) {
        			var output_slew = calculatePinSlewRate(flipflop_outputs[pin], output_pin_delay_info["is_rise_transition"], "CLK", load_capacitance);
        			g.node(flipflop_outputs[pin]).delay = output_pin_delay_info["delay"];
        			for (var i = 0; i < g.outEdges(flipflop_outputs[pin]).length; i++)        //adds correspoding slew to connected input gates
        				g.node(g.outEdges(flipflop_outputs[pin])[i].w).slew = output_slew;
        		}
        		W.push(flipflop_outputs[pin])
        	}
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
        	if(g.node(output_pin).type.indexOf("DFF") > -1) {
        		var input_pin_name = "CLK";
        		var input_slew = 0.0;
        	}
        	else {
	        	var input_slew = g.node(input_pin).slew;
	        	var input_pin_name = g.node(input_pin).pin_name;
	        }

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
        	if(g.node(output_pin).type.indexOf("DFF") > -1){
        		var input_pin_name = "CLK";
        		var input_slew = 0.0
        	}
        	else {
	        	var input_slew = g.node(input_pin).slew;
	        	var input_pin_name = g.node(input_pin).pin_name;
	        }
        	var output_slew = 0.0;


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

        function calculateSetupTime(output_pin) {
        	var D_slew = 0.0;
        	var CLK_slew = 0.0;
        	var FF_type = g.node(output_pin).type;
        	var SCL_cells = app["library"].cells;

        	for(var i in g.inEdges(output_pin))
        		if (g.node(g.inEdges(output_pin)[i].v).pin_name == "D")
        			D_slew = g.node(g.inEdges(output_pin)[i].v).slew

        	//possible x and y values of output delay NLDM table
        	var falling_x_values = (SCL_cells[FF_type].setup_rising.fall_constraint.x_values).sort().slice();
        	var falling_y_values = (SCL_cells[FF_type].setup_rising.fall_constraint.y_values).sort().slice();

        	var falling_xs = getValuesAround(D_slew, falling_x_values);
        	var falling_ys = getValuesAround(CLK_slew, falling_y_values);

        	var Q11 = SCL_cells[FF_type].setup_rising.fall_constraint.table[falling_ys[0]][falling_xs[0]],
        		Q21 = SCL_cells[FF_type].setup_rising.fall_constraint.table[falling_ys[0]][falling_xs[1]],
        		Q12 = SCL_cells[FF_type].setup_rising.fall_constraint.table[falling_ys[1]][falling_xs[0]],
        		Q22 = SCL_cells[FF_type].setup_rising.fall_constraint.table[falling_ys[1]][falling_xs[1]];

			var falling_delay = calcBilinearInterpolantion(falling_xs[0],D_slew,falling_xs[1],falling_ys[0],CLK_slew,falling_ys[1],Q11,Q21,Q12,Q22);


        	var rising_x_values = (SCL_cells[FF_type].setup_rising.rise_constraint.x_values).sort().slice();
        	var rising_y_values = (SCL_cells[FF_type].setup_rising.rise_constraint.y_values).sort().slice();

			var rising_xs = getValuesAround(D_slew, rising_x_values);
        	var rising_ys = getValuesAround(CLK_slew, rising_y_values);

			Q11 = SCL_cells[FF_type].setup_rising.rise_constraint.table[rising_ys[0]][rising_xs[0]];
        	Q21 = SCL_cells[FF_type].setup_rising.rise_constraint.table[rising_ys[0]][rising_xs[1]];
        	Q12 = SCL_cells[FF_type].setup_rising.rise_constraint.table[rising_ys[1]][rising_xs[0]];
        	Q22 = SCL_cells[FF_type].setup_rising.rise_constraint.table[rising_ys[1]][rising_xs[1]];

        	var rising_delay = calcBilinearInterpolantion(rising_xs[0],D_slew,rising_xs[1],rising_ys[0],CLK_slew,rising_ys[1],Q11,Q21,Q12,Q22);

        	console.log(output_pin)
        	console.log(D_slew)
        	console.log(falling_xs)
        	console.log(falling_ys)
        	console.log(rising_delay)
        	console.log(falling_delay)
        	//what if falling == rising, what happens to input transition calculation?
        	if(falling_delay > rising_delay)
        		return falling_delay;
        	else
        		return rising_delay;
        }

        function injectHoldTimes() {
        	for(var i = 0; i < flipflop_inputs.length; i++)
        	{
        		var D_slew = g.node(flipflop_inputs[i]).slew;
        		var CLK_slew = 0.0;
        		var FF_type = g.node(flipflop_inputs[i]).type;
        		var SCL_cells = app["library"].cells;

        		var falling_x_values = (SCL_cells[FF_type].setup_rising.fall_constraint.x_values).sort().slice();
	        	var falling_y_values = (SCL_cells[FF_type].setup_rising.fall_constraint.y_values).sort().slice();

	        	var falling_xs = getValuesAround(D_slew, falling_x_values);
	        	var falling_ys = getValuesAround(CLK_slew, falling_y_values);

	        	var Q11 = Math.abs(SCL_cells[FF_type].hold_rising.fall_constraint.table[falling_ys[0]][falling_xs[0]]),
	        		Q21 = Math.abs(SCL_cells[FF_type].hold_rising.fall_constraint.table[falling_ys[0]][falling_xs[1]]),
	        		Q12 = Math.abs(SCL_cells[FF_type].hold_rising.fall_constraint.table[falling_ys[1]][falling_xs[0]]),
	        		Q22 = Math.abs(SCL_cells[FF_type].hold_rising.fall_constraint.table[falling_ys[1]][falling_xs[1]]);

				var falling_delay = calcBilinearInterpolantion(falling_xs[0],D_slew,falling_xs[1],falling_ys[0],CLK_slew,falling_ys[1],Q11,Q21,Q12,Q22);


	        	var rising_x_values = (SCL_cells[FF_type].hold_rising.rise_constraint.x_values).sort().slice();
	        	var rising_y_values = (SCL_cells[FF_type].hold_rising.rise_constraint.y_values).sort().slice();

				var rising_xs = getValuesAround(D_slew, rising_x_values);
	        	var rising_ys = getValuesAround(CLK_slew, rising_y_values);

				Q11 = Math.abs(SCL_cells[FF_type].hold_rising.rise_constraint.table[rising_ys[0]][rising_xs[0]]);
	        	Q21 = Math.abs(SCL_cells[FF_type].hold_rising.rise_constraint.table[rising_ys[0]][rising_xs[1]]);
	        	Q12 = Math.abs(SCL_cells[FF_type].hold_rising.rise_constraint.table[rising_ys[1]][rising_xs[0]]);
	        	Q22 = Math.abs(SCL_cells[FF_type].hold_rising.rise_constraint.table[rising_ys[1]][rising_xs[1]]);

	        	var rising_delay = calcBilinearInterpolantion(rising_xs[0],D_slew,rising_xs[1],rising_ys[0],CLK_slew,rising_ys[1],Q11,Q21,Q12,Q22);

	        	//what if falling == rising, what happens to input transition calculation?
	        	if(falling_delay < rising_delay)
	        		g.node(flipflop_inputs[i]).hold_time = falling_delay;
	        	else
	        		g.node(flipflop_inputs[i]).hold_time = rising_delay;
        	}
        }

        function injectInputDelays() {
        	var input_delays = app['timingconstraints'].input_delay;
        	var bit_delays = {}
        	var netlist_ports = app["netlist"].modules[Object.keys(app["netlist"].modules)[0]].ports; //returns netlist cells

        	for(var net in input_delays) {
        		for(var bit in netlist_ports[net].bits) {
        			bit_delays[netlist_ports[net].bits[bit]] = input_delays[net]
        		}
        	}
        	for (var i in input_net_ids_node_names)
        		if(i in bit_delays)
        			g.node(input_net_ids_node_names[i]).delay = bit_delays[i];
        }

        function injectOutputDelays() {
        	var output_delays = app['timingconstraints'].output_delay;
        	var bit_delays = {};
        	var netlist_ports = app["netlist"].modules[Object.keys(app["netlist"].modules)[0]].ports; //returns netlist cells

        	for(var net in output_delays) {
        		for(var bit in netlist_ports[net].bits) {
        			bit_delays[netlist_ports[net].bits[bit]] = output_delays[net]
        		}
        	}
        	for (var i in output_net_ids_node_names)
        		if(i in bit_delays)
        			g.node(output_net_ids_node_names[i]).delay = bit_delays[i];

        }
        function calculateAAT() {
        	var W = input_ports.slice();		//Makes a copy of starting_nodes instead of reference
        	for(var i in flipflop_outputs)
        		W.push(flipflop_outputs[i])
        	var edge_tracker = {};		//Keeps track of whether all the incoming edges of an output node have been traversed

        	for(var vertex = 0; vertex < W.length; vertex++) {
        		var nodes = g.outEdges(W[vertex]);

        		for(var node in nodes) {
        			var pin = nodes[node].w;

        			//if pin in output pins
        			if(output_pins.indexOf(pin) > -1) {
        				var output_pin = g.node(pin);
        				if(output_pin.type.indexOf("DFF") > -1)
        					continue;
        				var output_AAT = g.node(g.inEdges(W[vertex])[0].v).delay + g.node(g.inEdges(W[vertex])[0].v).AAT; //+ g.edge({v:g.inEdges(W[vertex])[0].v, w:W[vertex]});
        				if(output_AAT > output_pin.AAT)
        				 	output_pin.AAT = output_AAT;


        				if(pin in edge_tracker)
        					edge_tracker[pin]++;
        				else
        					edge_tracker[pin] = 1;
        				if(g.nodeEdges(pin).length - g.outEdges(pin).length == edge_tracker[pin])
        					W.push(pin);

        				}
        			else if(output_ports.indexOf(pin) > -1) {
        				var output_pin = g.node(pin);
        				var output_AAT = g.node(W[vertex]).delay + g.node(W[vertex]).AAT// + g.edge({v:W[vertex], w: pin});
        				 if(output_AAT > output_pin.AAT)
        				 	output_pin.AAT = output_AAT;


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

        function calculateRT() {
        	var W = output_ports.slice();		//Makes a copy of starting_nodes instead of reference

        	var edge_tracker = {};		//Keeps track of whether all the incoming edges of an output node have been traversed

        	for(var pin in W)
        	{
        		g.node(W[pin]).RT = app['timingconstraints'].clock - g.node(W[pin]).delay;
        	}
        	for(var flip in flipflop_outputs)
        		W.push(flipflop_outputs[flip]);
        	for(var vertex = 0; vertex < W.length; vertex++) {
        		var nodes = g.inEdges(W[vertex]);

        		for(var node in nodes) {
        			var pin = nodes[node].v;

        			//if pin in output pins
        			if(g.node(pin).type.indexOf("DFF") > -1) {
        				if(W.indexOf(pin) == -1)
        					W.push(pin)
        			}
        			else if(output_pins.indexOf(pin) > -1) {
        				var output_pin = g.node(pin);
        				var current_RT;
        				if(g.node(W[vertex]).direction == "output")
        					current_RT = g.node(W[vertex]).RT - g.node(W[vertex]).delay
        				else
        					current_RT = g.node(g.outEdges(W[vertex])[0].w).RT - g.node(g.outEdges(W[vertex])[0].w).delay

        				if(current_RT < output_pin.RT && output_pin.pin_name != "Q")
        				 	output_pin.RT = current_RT;


        				if(pin in edge_tracker)
        					edge_tracker[pin]++;
        				else
        					edge_tracker[pin] = 1;
        				if(g.outEdges(pin).length == edge_tracker[pin])
        					W.push(pin);

        				}
        			else
        				W.push(pin);
        		}
        	}

        }
        function calculateFFRT() {
        	var CP = app['timingconstraints'].clock;
        	for(var flip in flipflop_outputs) {
        		g.node(flipflop_outputs[flip]).RT = CP + g.node(flipflop_outputs[flip]).skew - calculateSetupTime(flipflop_outputs[flip]);
        	}
        }
        function calculateFFAAT() {

        	var input_to_FF_paths = [];
        	var FF_to_FF_paths = [];
        	var flag = true;

        	for (var i = 0; i < g.nodes().length; i++)
                visited[g.nodes()[i]] = false;

        	for(var input in input_ports)
        		for(var D in flipflop_inputs) {
        			current_path = [];
                    all_paths = [];
                    identifyTimingPaths(input_ports[input], flipflop_inputs[D]);

                    for (var i = 0; i < all_paths.length; i++) {
                    	flag = true;
                    	for(var j = 0; j < all_paths[i].length; j++)
                    		if(g.node(all_paths[i][j]).type.indexOf("DFF") > -1 && all_paths[i][j] != flipflop_inputs[D]) {
                    			flag = false;
                    			break;
                    	}
                    	if(flag) input_to_FF_paths.push(all_paths[i]);
                    }
                }
            for(var i = 0; i < input_to_FF_paths.length; i++) {
            	var AAT = 0;
            	for(var j = 0; j < input_to_FF_paths[i].length; j++)
            		AAT += g.node(input_to_FF_paths[i][j]).delay;
            	if(AAT > g.node(g.outEdges(input_to_FF_paths[i][input_to_FF_paths[i].length - 1])[0].w).AAT) { //AAT > Q of flipflop
            		g.node(g.outEdges(input_to_FF_paths[i][input_to_FF_paths[i].length - 1])[0].w).AAT = AAT;
            	}
            }

            for (var i = 0; i < g.nodes().length; i++)
                visited[g.nodes()[i]] = false;
            for(var Q in flipflop_outputs)
            	for(var D in flipflop_inputs) {
        			current_path = [];
                    all_paths = [];
                    identifyTimingPaths(flipflop_outputs[Q], flipflop_inputs[D]);
                 	for (var i = 0; i < all_paths.length; i++) {
                    	flag = true;
                    	for(var j = 1; j < all_paths[i].length; j++)
                    		if(g.node(all_paths[i][j]).type.indexOf("DFF") > -1 && all_paths[i][j] != flipflop_inputs[D]) {
                    			flag = false;
                    			break;
                    	}
                    	if(flag) FF_to_FF_paths.push(all_paths[i]);
            	}

            }
            for(var i = 0; i < FF_to_FF_paths.length; i++) {
            	var AAT = 0;
            	for(var j = 0; j < FF_to_FF_paths[i].length; j++)
            		AAT += g.node(FF_to_FF_paths[i][j]).delay;
            	AAT += g.node(g.outEdges(FF_to_FF_paths[i][FF_to_FF_paths[i].length - 1])[0].w).skew;
            	if(AAT > g.node(g.outEdges(FF_to_FF_paths[i][FF_to_FF_paths[i].length - 1])[0].w).AAT) { //AAT > Q of flipflop
            		g.node(g.outEdges(FF_to_FF_paths[i][FF_to_FF_paths[i].length - 1])[0].w).AAT = AAT;
            	}
            }
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

        function injectClockSkews() {
        	var netlist_cells = app["netlist"].modules[Object.keys(app["netlist"].modules)[0]].cells; //returns netlist cells
        	for(var i in app["clock_skews"])
        	{
        		g.node(flipflop_outputs_by_cell_name[i]).skew = app["clock_skews"][i];
        	}
        }

        function printPath(path, slack) {
            var total_delay = 0.0;
            var delay, node;

            var table = $("<table></table>")
                        .append("<thead><tr></tr></thead>")
                        .append("<tbody/>");

            var head = table.find("thead > tr");
            ['Pin', 'Type', 'Incr', 'Total Delay'].forEach(function (th) {
                head.append($("<th/>", {
                    html: th
                }));
            });

            var body = table.find("tbody");

            for (var i = 0; i < path.length; i++) {
                node = g.node(path[i]);
                delay = 0.0;
                total_delay += node.delay;

                var row = $("<tr/>");
                [
                    path[i],
                    node.type,
                    Math.round(node.delay * 1000),
                    Math.round(total_delay * 1000),
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
            if(slack != undefined)
                $("#output").append("Path Slack: " + Math.round(slack*1000)).append("<br/><br/>")
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
