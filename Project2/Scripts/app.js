/// <reference path="jquery-2.2.2.min.js" />

var app;
$(function () {
    "use strict";

    app = new function () {
        var that = this;


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
            createNetlistDAG(app["netlist"]);
            alert("all loaded");
        }

        function createNetlistDAG(vnetlist) {
            var g = new graphlib.Graph();

            var cell_count = 0;
            var input_nodes = {}, output_nodes = {};
            var netlist_cells = vnetlist.modules[Object.keys(vnetlist.modules)[0]].cells; //returns cells
            var netlist_ports = vnetlist.modules[Object.keys(vnetlist.modules)[0]].ports;

            for (var cell in netlist_cells) {
                var current_cell = netlist_cells[cell];
                var cell_name = (current_cell.type.slice(2, -1) + cell_count);

                g.setNode(cell_name, current_cell);       //set nodes with their type as keys, set as delay later

                //only parses 1 bit, does not parse buses
                for (var connection in current_cell.connections) {
                    var net_id = current_cell.connections[connection][0];                //id of wire
                    if (!("_" + net_id + "_" in g.nodes())) g.setNode("_" + net_id + "_");
                    if (current_cell.port_directions[connection] == "input") g.setEdge("_" + net_id + "_", cell_name);
                    else g.setEdge(cell_name, "_" + net_id + "_");
                }
                cell_count++;
            }

            //sets a dict for the input and output nodes
            for (var port in netlist_ports) {
                if (netlist_ports[port].direction === "input")
                    input_nodes[port] = "_" + netlist_ports[port].bits[0] + "_";
                else if (netlist_ports[port].direction === "output")
                    output_nodes[port] = "_" + netlist_ports[port].bits[0] + "_";
            }
        }
    };
});